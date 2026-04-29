/**
 * Sentry API pagination utilities.
 *
 * Sentry uses cursor-based pagination via HTTP Link headers.
 * These helpers make it ergonomic to paginate through results
 * returned by the generated SDK functions.
 */

// This type mirrors the SDK's RequestResult<TData, TError, false, 'fields'>
// discriminated union shape. We define it locally so this module has zero
// imports from generated code — it must remain self-contained.
type SdkResult<TData = unknown, TError = unknown> = (
  | { data: TData; error: undefined }
  | { data: undefined; error: TError }
) & {
  request: Request;
  response: Response;
};

export type UnwrappedResult<TData> = {
  data: TData;
  response: Response;
};

export type PaginatedResponse<T> = {
  data: T;
  /** Cursor for the next page. `undefined` when there are no more pages. */
  nextCursor?: string;
  /** Cursor for the previous page. `undefined` on the first page. */
  prevCursor?: string;
};

export type PaginateAllOptions = {
  /** Hard cap on the number of pages fetched. Default: 50. */
  maxPages?: number;
};

export type PaginateUpToOptions = {
  /** Hard cap on the number of items returned. Required. */
  limit: number;
  /** Safety cap on the number of pages fetched. Default: 50. */
  maxPages?: number;
  /** Resume pagination from this cursor instead of starting from the beginning. */
  startCursor?: string;
  /** Called after each page is fetched. Useful for progress indicators. */
  onPage?: (fetched: number, limit: number) => void;
  /**
   * When true, preserve `nextCursor` even when the last page was trimmed
   * to fit `limit`. Default: false (the safe default — see body comment).
   *
   * Use this only for endpoints that have **no** server-side per-page
   * control (so the trimmed tail items remain reachable via the same
   * cursor on the next call). Sentry's `/issues/{id}/events/` is one
   * such endpoint: it has no `per_page` param, so dropping the cursor
   * on overshoot would orphan the items the helper trimmed.
   *
   * For endpoints that DO support `per_page` / `limit`, leave this
   * `false` — returning a cursor that points past trimmed items would
   * cause callers resuming pagination to skip records.
   */
  keepCursorOnOvershoot?: boolean;
};

export type PageFetcher<TData, TError> = (
  cursor: string | undefined,
) => Promise<SdkResult<TData, TError>>;

/**
 * Parse Sentry's Link header to extract pagination cursors.
 *
 * Sentry returns Link headers in the format:
 *   <url>; rel="previous"; results="true"; cursor="abc:0:1";,
 *   <url>; rel="next"; results="true"; cursor="1234:0:0";
 *
 * Returns `{ nextCursor?, prevCursor? }`:
 *   - `nextCursor` set when there is a next page.
 *   - `prevCursor` set when there is a previous page.
 *
 * The `results="true"` qualifier is required — Sentry includes a
 * `previous` rel even on the first page, but with `results="false"`.
 * We honor that signal so first-page callers don't see a bogus `prevCursor`.
 */
export const parseSentryLinkHeader = (
  header: string | null,
): { nextCursor?: string; prevCursor?: string } => {
  if (!header) {
    return {};
  }

  const segments = header.split(",");

  let nextCursor: string | undefined;
  let prevCursor: string | undefined;

  for (const segment of segments) {
    const parts = segment.trim().split(";").map((s) => s.trim());

    let rel: string | undefined;
    let results: string | undefined;
    let cursor: string | undefined;

    for (const part of parts) {
      const relMatch = part.match(/^rel="([^"]*)"$/);
      if (relMatch) {
        rel = relMatch[1];
        continue;
      }
      const resultsMatch = part.match(/^results="([^"]*)"$/);
      if (resultsMatch) {
        results = resultsMatch[1];
        continue;
      }
      const cursorMatch = part.match(/^cursor="([^"]*)"$/);
      if (cursorMatch) {
        cursor = cursorMatch[1];
        continue;
      }
    }

    if (results !== "true" || !cursor) {
      continue;
    }
    if (rel === "next") {
      nextCursor = cursor;
    } else if (rel === "previous") {
      prevCursor = cursor;
    }
  }

  const out: { nextCursor?: string; prevCursor?: string } = {};
  if (nextCursor !== undefined) out.nextCursor = nextCursor;
  if (prevCursor !== undefined) out.prevCursor = prevCursor;
  return out;
};

/**
 * Internal: merge a managed `cursor` into an SDK call's `options.query`
 * and re-shape the result back to the SDK's `Options<TData>` type.
 *
 * Used exclusively by the auto-generated wrappers in `pagination.gen.ts`
 * (one call per wrapper kind, one `_withCursor` invocation per page).
 * Centralizes the cast chain — every wrapper used to inline its own
 * `as unknown as ...` quartet, which meant the same logic was repeated
 * once per generated wrapper (~115 places). This helper makes that
 * exactly one place.
 *
 * Type-erasure rationale: each SDK operation has its own `Options<TData>`
 * shape with operation-specific `query`, `path`, and `body` types. We
 * can't write a generic that's tight enough to satisfy all 200+ SDK
 * functions structurally without committing to a discriminated-union
 * encoding of every operation. The `_` prefix marks this as internal —
 * the typed wrappers in `pagination.gen.ts` are the supported public API.
 *
 * @internal
 */
export const _withCursor = <TOptions>(
  options: { query?: unknown; [k: string]: unknown },
  cursor: string | undefined,
): TOptions =>
  ({
    ...options,
    query: {
      ...(options.query as Record<string, unknown> | undefined),
      cursor,
    },
  }) as unknown as TOptions;

/**
 * Unwrap an SDK result, throwing on error.
 *
 * Returns `{ data, response }` so callers retain access to the
 * raw Response (and its headers) for pagination or other needs.
 */
export const unwrapResult = <TData>(
  result: SdkResult<TData>,
  context: string,
): UnwrappedResult<TData> => {
  if (result.error !== undefined) {
    throw new Error(
      `${context}: API request failed: ${JSON.stringify(result.error)}`,
    );
  }
  return { data: result.data as TData, response: result.response };
};

/**
 * Unwrap an SDK result and extract pagination cursors from the
 * Link header. Throws on error.
 *
 * Returns `{ data, nextCursor?, prevCursor? }`. Each cursor is
 * `undefined` when the corresponding rel does not exist or has
 * `results="false"`.
 */
export const unwrapPaginatedResult = <TData>(
  result: SdkResult<TData>,
  context: string,
): PaginatedResponse<TData> => {
  const { data, response } = unwrapResult(result, context);
  const linkHeader = response.headers.get("link");
  const { nextCursor, prevCursor } = parseSentryLinkHeader(linkHeader);
  const out: PaginatedResponse<TData> = { data };
  if (nextCursor !== undefined) out.nextCursor = nextCursor;
  if (prevCursor !== undefined) out.prevCursor = prevCursor;
  return out;
};

/**
 * Fetch a single page from a Sentry list endpoint and return both
 * the data and the pagination cursors.
 *
 * Thin wrapper over an SDK function call: invokes the fetcher with
 * an optional cursor, unwraps the result, and parses the Link header.
 *
 * Useful when you want manual control over pagination (e.g. exposing
 * a "next page" button in a UI) instead of fetching all pages eagerly.
 *
 * @example
 * ```ts
 * const { data, nextCursor } = await fetchPage(
 *   (cursor) => listAnOrganization_sRepositories({
 *     path: { organization_id_or_slug: 'my-org' },
 *     query: { cursor },
 *   }),
 *   'listRepos',
 * );
 * ```
 */
export const fetchPage = async <TData, TError = unknown>(
  fetcher: PageFetcher<TData, TError>,
  context: string,
  cursor?: string,
): Promise<PaginatedResponse<TData>> => {
  const result = await fetcher(cursor);
  return unwrapPaginatedResult(result, context);
};

/**
 * Automatically paginate through all pages of a Sentry list endpoint.
 *
 * Fetches pages sequentially until there is no next cursor or
 * `maxPages` is reached (default: 50). Returns all items concatenated.
 *
 * @example
 * ```ts
 * const allRepos = await paginateAll(
 *   (cursor) => listAnOrganization_sRepositories({
 *     path: { organization_id_or_slug: 'my-org' },
 *     query: { cursor },
 *   }),
 *   'listRepos',
 * );
 * ```
 */
export const paginateAll = async <TItem, TError = unknown>(
  fetcher: PageFetcher<Array<TItem>, TError>,
  context: string,
  options?: PaginateAllOptions,
): Promise<Array<TItem>> => {
  const maxPages = options?.maxPages ?? 50;
  const allItems: Array<TItem> = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const result = await fetcher(cursor);
    const { data, nextCursor } = unwrapPaginatedResult(result, context);
    allItems.push(...data);

    if (!nextCursor) {
      break;
    }
    cursor = nextCursor;
  }

  return allItems;
};

/**
 * Paginate up to a hard limit of items, suppressing the next-cursor
 * if the last fetched page had to be trimmed to fit.
 *
 * The trim-and-suppress behavior is intentional: returning a cursor
 * that points past the trimmed items would cause callers resuming
 * pagination to skip records. When the requested limit is reached
 * mid-page, no `nextCursor` is returned and the caller should treat
 * the result as the final page they're going to fetch.
 *
 * @example
 * ```ts
 * // Fetch up to 250 issues, in pages of 100 (Sentry's API max)
 * const { data, nextCursor } = await paginateUpTo(
 *   (cursor) => listAnOrganization_sIssues({
 *     path: { organization_id_or_slug: 'my-org' },
 *     query: { cursor, limit: 100 },
 *   }),
 *   { limit: 250 },
 *   'listIssues',
 * );
 * ```
 */
export const paginateUpTo = async <TItem, TError = unknown>(
  fetcher: PageFetcher<Array<TItem>, TError>,
  options: PaginateUpToOptions,
  context: string,
): Promise<{ data: Array<TItem>; nextCursor?: string }> => {
  if (options.limit < 1) {
    throw new Error(
      `paginateUpTo: limit must be at least 1, got ${options.limit}`,
    );
  }

  const maxPages = options.maxPages ?? 50;
  const allItems: Array<TItem> = [];
  let cursor: string | undefined = options.startCursor;

  for (let page = 0; page < maxPages; page++) {
    const result = await fetcher(cursor);
    const { data, nextCursor } = unwrapPaginatedResult(result, context);
    allItems.push(...data);

    options.onPage?.(Math.min(allItems.length, options.limit), options.limit);

    if (allItems.length >= options.limit || !nextCursor) {
      // If we overshot the limit, trim. The cursor handling depends on
      // `keepCursorOnOvershoot`:
      //   - default (`false`): drop the cursor — returning one that points
      //     past the trimmed items causes callers resuming pagination to
      //     skip records. Safe for endpoints with `per_page` / `limit`
      //     control where the caller can avoid overshoot in the first place.
      //   - `true`: preserve the cursor — required for endpoints with no
      //     server-side page-size control, where the trimmed tail items
      //     are still reachable via the same cursor on the next call
      //     (e.g. Sentry's `/issues/{id}/events/`).
      if (allItems.length > options.limit) {
        const trimmed = allItems.slice(0, options.limit);
        if (options.keepCursorOnOvershoot && nextCursor !== undefined) {
          return { data: trimmed, nextCursor };
        }
        return { data: trimmed };
      }
      const out: { data: Array<TItem>; nextCursor?: string } = { data: allItems };
      if (nextCursor !== undefined) out.nextCursor = nextCursor;
      return out;
    }

    cursor = nextCursor;
  }

  // Safety cap reached — return what we have, no nextCursor (resuming
  // would re-fetch already-returned pages, which is worse than stopping).
  return { data: allItems.slice(0, options.limit) };
};
