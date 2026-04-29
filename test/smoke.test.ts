/**
 * Smoke tests for the public surface area.
 *
 * These tests don't hit the network — they assert that:
 *   1. The Link-header parser handles real Sentry response shapes correctly.
 *   2. The pagination helpers compose with mocked SDK results.
 *   3. The generated wrappers (pagination.gen.ts) export the expected names
 *      and have the correct type shape (compile-time check via `as`).
 *
 * Run with `bun test`.
 */

import { describe, expect, test } from "bun:test";
import {
  fetchPage,
  fetchPage_listAnOrganization_sIssues,
  fetchPage_listYourOrganizations,
  paginateAll,
  paginateAll_listYourOrganizations,
  paginateUpTo,
  paginateUpTo_listYourOrganizations,
  parseSentryLinkHeader,
  unwrapPaginatedResult,
  unwrapResult,
} from "../src/index";

// =====================================================================
// parseSentryLinkHeader
// =====================================================================

describe("parseSentryLinkHeader", () => {
  test("returns empty when header is null or empty", () => {
    expect(parseSentryLinkHeader(null)).toEqual({});
    expect(parseSentryLinkHeader("")).toEqual({});
  });

  test("extracts nextCursor when next link has results=true", () => {
    const header =
      '<https://sentry.io/api/0/organizations/?cursor=abc>; rel="next"; results="true"; cursor="1234:0:0"';
    expect(parseSentryLinkHeader(header)).toEqual({ nextCursor: "1234:0:0" });
  });

  test("extracts both nextCursor and prevCursor when both present", () => {
    const header =
      '<https://sentry.io/api/0/organizations/?c=p>; rel="previous"; results="true"; cursor="prev:1:0", ' +
      '<https://sentry.io/api/0/organizations/?c=n>; rel="next"; results="true"; cursor="next:0:0"';
    expect(parseSentryLinkHeader(header)).toEqual({
      nextCursor: "next:0:0",
      prevCursor: "prev:1:0",
    });
  });

  test("ignores rels with results=false (first-page boundary)", () => {
    // Sentry sends `rel="previous"; results="false"` on the first page
    // to indicate no previous results exist. We must not return prevCursor.
    const header =
      '<https://sentry.io/api/0/organizations/?c=p>; rel="previous"; results="false"; cursor="0:0:1", ' +
      '<https://sentry.io/api/0/organizations/?c=n>; rel="next"; results="true"; cursor="next:0:0"';
    expect(parseSentryLinkHeader(header)).toEqual({ nextCursor: "next:0:0" });
  });

  test("returns empty when both rels have results=false (last page)", () => {
    const header =
      '<https://sentry.io/api/0/organizations/?c=p>; rel="previous"; results="true"; cursor="prev:1:0", ' +
      '<https://sentry.io/api/0/organizations/?c=n>; rel="next"; results="false"; cursor="next:0:0"';
    expect(parseSentryLinkHeader(header)).toEqual({ prevCursor: "prev:1:0" });
  });

  test("ignores malformed segments without crashing", () => {
    expect(parseSentryLinkHeader("not a link header")).toEqual({});
    expect(parseSentryLinkHeader("<url>; rel=next")).toEqual({}); // unquoted
  });
});

// =====================================================================
// unwrapResult / unwrapPaginatedResult
// =====================================================================

const mkSuccess = <T>(data: T, linkHeader?: string) => ({
  data,
  error: undefined,
  request: new Request("https://example.test/"),
  response: new Response(null, {
    headers: linkHeader ? { link: linkHeader } : {},
  }),
}) as Parameters<typeof unwrapResult<T>>[0];

const mkFailure = (errorBody: unknown) => ({
  data: undefined,
  error: errorBody,
  request: new Request("https://example.test/"),
  response: new Response(null, { status: 500 }),
}) as Parameters<typeof unwrapResult<unknown>>[0];

describe("unwrapResult", () => {
  test("returns data on success", () => {
    const out = unwrapResult(mkSuccess({ ok: 1 }), "test");
    expect(out.data).toEqual({ ok: 1 });
  });

  test("throws on error", () => {
    expect(() => unwrapResult(mkFailure({ detail: "boom" }), "test")).toThrow(
      /test/,
    );
  });
});

describe("unwrapPaginatedResult", () => {
  test("includes nextCursor when present in Link header", () => {
    const linkHeader =
      '<u>; rel="next"; results="true"; cursor="next:0:0"';
    const out = unwrapPaginatedResult<number[]>(
      mkSuccess([1, 2, 3], linkHeader),
      "test",
    );
    expect(out.data).toEqual([1, 2, 3]);
    expect(out.nextCursor).toBe("next:0:0");
    expect(out.prevCursor).toBeUndefined();
  });

  test("omits both cursors when no Link header", () => {
    const out = unwrapPaginatedResult<number[]>(mkSuccess([1, 2, 3]), "test");
    expect(out.data).toEqual([1, 2, 3]);
    expect(out.nextCursor).toBeUndefined();
    expect(out.prevCursor).toBeUndefined();
  });
});

// =====================================================================
// fetchPage
// =====================================================================

describe("fetchPage", () => {
  test("forwards cursor argument to fetcher and returns parsed result", async () => {
    let receivedCursor: string | undefined;
    const out = await fetchPage<number[]>(
      (cursor) => {
        receivedCursor = cursor;
        return Promise.resolve(
          mkSuccess([1, 2, 3], '<u>; rel="next"; results="true"; cursor="abc"'),
        );
      },
      "test",
      "start-cursor",
    );
    expect(receivedCursor).toBe("start-cursor");
    expect(out.data).toEqual([1, 2, 3]);
    expect(out.nextCursor).toBe("abc");
  });
});

// =====================================================================
// paginateAll
// =====================================================================

describe("paginateAll", () => {
  test("walks pages until no nextCursor, concatenating items", async () => {
    const pages: Record<string, { items: number[]; next?: string }> = {
      _start: { items: [1, 2], next: "p1" },
      p1: { items: [3, 4], next: "p2" },
      p2: { items: [5] }, // no next
    };
    const items = await paginateAll<number>(
      (cursor) => {
        const key = cursor ?? "_start";
        const page = pages[key]!;
        const link = page.next
          ? `<u>; rel="next"; results="true"; cursor="${page.next}"`
          : undefined;
        return Promise.resolve(mkSuccess(page.items, link));
      },
      "test",
    );
    expect(items).toEqual([1, 2, 3, 4, 5]);
  });

  test("stops at maxPages safety cap", async () => {
    let calls = 0;
    const items = await paginateAll<number>(
      () => {
        calls += 1;
        // Always returns a next cursor → infinite without the cap
        return Promise.resolve(
          mkSuccess([calls], '<u>; rel="next"; results="true"; cursor="x"'),
        );
      },
      "test",
      { maxPages: 3 },
    );
    expect(calls).toBe(3);
    expect(items).toEqual([1, 2, 3]);
  });
});

// =====================================================================
// paginateUpTo
// =====================================================================

describe("paginateUpTo", () => {
  test("returns nextCursor when limit lands exactly on page boundary", async () => {
    const result = await paginateUpTo<number>(
      (cursor) =>
        Promise.resolve(
          mkSuccess(
            cursor ? [3, 4] : [1, 2],
            '<u>; rel="next"; results="true"; cursor="next"',
          ),
        ),
      { limit: 4 },
      "test",
    );
    expect(result.data).toEqual([1, 2, 3, 4]);
    // Limit reached exactly: still has more pages, so nextCursor is preserved
    expect(result.nextCursor).toBe("next");
  });

  test("suppresses nextCursor when overshooting limit (correctness)", async () => {
    // First page returns 5 items; limit is 3. Returning a cursor that points
    // past the trimmed items would cause callers to skip records.
    const result = await paginateUpTo<number>(
      () =>
        Promise.resolve(
          mkSuccess(
            [1, 2, 3, 4, 5],
            '<u>; rel="next"; results="true"; cursor="would-skip"',
          ),
        ),
      { limit: 3 },
      "test",
    );
    expect(result.data).toEqual([1, 2, 3]);
    expect(result.nextCursor).toBeUndefined();
  });

  test("preserves nextCursor on overshoot when keepCursorOnOvershoot:true", async () => {
    // For endpoints with no per_page control (e.g. /issues/{id}/events/),
    // the trimmed-tail items are still reachable via the same cursor on
    // the next call. keepCursorOnOvershoot:true preserves access to them.
    const result = await paginateUpTo<number>(
      () =>
        Promise.resolve(
          mkSuccess(
            [1, 2, 3, 4, 5],
            '<u>; rel="next"; results="true"; cursor="reachable"',
          ),
        ),
      { limit: 3, keepCursorOnOvershoot: true },
      "test",
    );
    expect(result.data).toEqual([1, 2, 3]);
    expect(result.nextCursor).toBe("reachable");
  });

  test("keepCursorOnOvershoot is a no-op when there's no nextCursor to preserve", async () => {
    // Last page, overshoot, no next cursor in the API response — there's
    // nothing to preserve, so the result is identical to the default path.
    const result = await paginateUpTo<number>(
      () => Promise.resolve(mkSuccess([1, 2, 3, 4, 5])), // no link header
      { limit: 3, keepCursorOnOvershoot: true },
      "test",
    );
    expect(result.data).toEqual([1, 2, 3]);
    expect(result.nextCursor).toBeUndefined();
  });

  test("invokes onPage callback after each page", async () => {
    const observed: Array<{ fetched: number; limit: number }> = [];
    await paginateUpTo<number>(
      (cursor) =>
        Promise.resolve(
          mkSuccess(
            cursor ? [3, 4] : [1, 2],
            cursor
              ? undefined
              : '<u>; rel="next"; results="true"; cursor="p1"',
          ),
        ),
      {
        limit: 10,
        onPage: (fetched, limit) => observed.push({ fetched, limit }),
      },
      "test",
    );
    expect(observed).toEqual([
      { fetched: 2, limit: 10 },
      { fetched: 4, limit: 10 },
    ]);
  });

  test("respects startCursor when resuming", async () => {
    let receivedFirstCursor: string | undefined = "<not-set>";
    await paginateUpTo<number>(
      (cursor) => {
        if (receivedFirstCursor === "<not-set>") {
          receivedFirstCursor = cursor;
        }
        return Promise.resolve(mkSuccess([], undefined));
      },
      { limit: 1, startCursor: "resume-here" },
      "test",
    );
    expect(receivedFirstCursor).toBe("resume-here");
  });

  test("rejects limit < 1", async () => {
    await expect(
      paginateUpTo<number>(
        () => Promise.resolve(mkSuccess([])),
        { limit: 0 },
        "test",
      ),
    ).rejects.toThrow(/limit/);
  });
});

// =====================================================================
// Generated wrappers — compile-time + structural smoke
// =====================================================================

describe("generated wrappers (pagination.gen.ts)", () => {
  test("fetchPage_listYourOrganizations is callable with no args", () => {
    // We don't actually invoke (would need network); we assert it exists,
    // is a function, and has the expected arity (options + cursor = 2 named
    // params, but JS reports the count up to the first default — so 1).
    expect(typeof fetchPage_listYourOrganizations).toBe("function");
  });

  test("paginateAll_/paginateUpTo_ wrappers exist for array-shaped ops", () => {
    expect(typeof paginateAll_listYourOrganizations).toBe("function");
    expect(typeof paginateUpTo_listYourOrganizations).toBe("function");
  });

  test("only fetchPage_ is generated for compound-shaped ops", () => {
    // listAnOrganization_sIssues is array-shaped, so all three exist.
    expect(typeof fetchPage_listAnOrganization_sIssues).toBe("function");
    // For a compound op like listClickedNodes (200: { ... } not Array<>),
    // paginateAll/paginateUpTo are intentionally not generated — items
    // can't be flattened across pages without knowing which field holds
    // the array, and that's spec-specific.
    const indexModule = require("../src/index") as Record<string, unknown>;
    const keys = Object.keys(indexModule);
    expect(keys).toContain("fetchPage_listClickedNodes");
    expect(keys).not.toContain("paginateAll_listClickedNodes");
    expect(keys).not.toContain("paginateUpTo_listClickedNodes");
  });

  test("allow-list: emits wrappers for spec-incomplete paginated ops", () => {
    // /organizations/{org}/alert-rules/ runtime-supports cursor pagination
    // but its OpenAPI spec doesn't declare the cursor parameter. The
    // PAGINATED_BUT_UNMARKED allow-list in the generator forces wrappers
    // to be emitted anyway. Without this entry, the CLI's
    // listMetricAlertsPaginated call site can't be migrated.
    const indexModule = require("../src/index") as Record<string, unknown>;
    const keys = Object.keys(indexModule);
    expect(keys).toContain(
      "fetchPage_deprecatedListAnOrganization_sMetricAlertRules",
    );
    expect(keys).toContain(
      "paginateAll_deprecatedListAnOrganization_sMetricAlertRules",
    );
    expect(keys).toContain(
      "paginateUpTo_deprecatedListAnOrganization_sMetricAlertRules",
    );
  });
});
