import { describe, expect, it } from "bun:test";
import {
  normalizeOperationId,
  normalizeSpec,
  parsePath,
  singularize,
} from "../lib/normalize-spec.mjs";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// singularize
// ---------------------------------------------------------------------------

describe("singularize", () => {
  it("removes trailing s for regular plurals", () => {
    expect(singularize("issues")).toBe("issue");
    expect(singularize("dashboards")).toBe("dashboard");
    expect(singularize("teams")).toBe("team");
    expect(singularize("projects")).toBe("project");
    expect(singularize("replays")).toBe("replay");
  });

  it("handles -ies plurals", () => {
    expect(singularize("activities")).toBe("activity");
    expect(singularize("queries")).toBe("query");
    expect(singularize("entries")).toBe("entry");
  });

  it("uses the irregular lookup table", () => {
    expect(singularize("aliases")).toBe("alias");
    expect(singularize("statuses")).toBe("status");
    expect(singularize("checkins")).toBe("checkin");
  });

  it("correctly singularizes releases (regression: -ses rule must not apply)", () => {
    expect(singularize("releases")).toBe("release");
  });

  it("leaves words ending in -ss, -us, -is untouched", () => {
    expect(singularize("class")).toBe("class");
    expect(singularize("status")).toBe("status");
    expect(singularize("analysis")).toBe("analysis");
  });

  it("leaves already-singular words untouched", () => {
    expect(singularize("event")).toBe("event");
    expect(singularize("monitor")).toBe("monitor");
  });

  it("is idempotent — applying twice produces the same result", () => {
    for (const w of ["issues", "teams", "releases", "queries", "activities"]) {
      expect(singularize(singularize(w))).toBe(singularize(w));
    }
  });

  it("never returns an empty string", () => {
    // Single-char input ending in s would produce "" without the stem guard.
    expect(singularize("s")).toBe("s");
    expect(singularize("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// parsePath
// ---------------------------------------------------------------------------

describe("parsePath", () => {
  it("strips /api/0/ prefix and trailing slash", () => {
    const segs = parsePath("/api/0/organizations/");
    expect(segs).toEqual([
      { value: "organizations", isParam: false, followedByParam: false },
    ]);
  });

  it("marks path params correctly", () => {
    const segs = parsePath("/api/0/organizations/{org}/issues/{id}/");
    expect(segs.map((s) => s.isParam)).toEqual([false, true, false, true]);
    expect(segs.map((s) => s.followedByParam)).toEqual([true, false, true, false]);
  });

  it("converts kebab-case to camelCase", () => {
    const segs = parsePath("/api/0/organizations/{org}/events-timeseries/");
    const values = segs.filter((s) => !s.isParam).map((s) => s.value);
    expect(values).toEqual(["organizations", "eventsTimeseries"]);
  });

  it("handles uppercase letters after a hyphen", () => {
    const segs = parsePath("/api/0/foo-Bar/");
    expect(segs[0]?.value).toBe("fooBar");
  });

  it("converts underscores to camelCase (e.g. stats_v2 → statsV2)", () => {
    const segs = parsePath("/api/0/organizations/{org}/stats_v2/");
    const statics = segs.filter((s) => !s.isParam);
    expect(statics.at(-1)?.value).toBe("statsV2");
  });

  it("drops empty segments from leading slashes (non-/api/0/ paths)", () => {
    const segs = parsePath("/custom/resources/");
    expect(segs.every((s) => s.value.length > 0)).toBe(true);
    expect(segs.map((s) => s.value)).toEqual(["custom", "resources"]);
  });

  it("returns empty array for a path of only params", () => {
    // parsePath itself never throws — normalizeOperationId validates the result
    const segs = parsePath("/api/0/{a}/{b}/");
    expect(segs.every((s) => s.isParam)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normalizeOperationId
// ---------------------------------------------------------------------------

describe("normalizeOperationId", () => {
  it("GET collection → list", () => {
    expect(normalizeOperationId("get", "/api/0/organizations/")).toBe(
      "listOrganizations",
    );
    expect(
      normalizeOperationId("get", "/api/0/organizations/{org}/issues/"),
    ).toBe("listOrganizationIssues");
    expect(
      normalizeOperationId(
        "get",
        "/api/0/organizations/{org}/issues/{id}/events/",
      ),
    ).toBe("listOrganizationIssueEvents");
  });

  it("GET detail (ends in param) → get + singularized", () => {
    expect(
      normalizeOperationId("get", "/api/0/organizations/{org}/"),
    ).toBe("getOrganization");
    expect(
      normalizeOperationId("get", "/api/0/organizations/{org}/issues/{id}/"),
    ).toBe("getOrganizationIssue");
    expect(
      normalizeOperationId(
        "get",
        "/api/0/organizations/{org}/dashboards/{id}/",
      ),
    ).toBe("getOrganizationDashboard");
  });

  it("POST → create + singularized last segment", () => {
    expect(
      normalizeOperationId("post", "/api/0/organizations/{org}/dashboards/"),
    ).toBe("createOrganizationDashboard");
    expect(
      normalizeOperationId("post", "/api/0/organizations/{org}/teams/"),
    ).toBe("createOrganizationTeam");
  });

  it("PUT/PATCH → update", () => {
    expect(
      normalizeOperationId("put", "/api/0/organizations/{org}/dashboards/{id}/"),
    ).toBe("updateOrganizationDashboard");
    expect(
      normalizeOperationId("patch", "/api/0/organizations/{org}/issues/{id}/"),
    ).toBe("updateOrganizationIssue");
  });

  it("DELETE detail → singular", () => {
    expect(
      normalizeOperationId(
        "delete",
        "/api/0/organizations/{org}/dashboards/{id}/",
      ),
    ).toBe("deleteOrganizationDashboard");
  });

  it("DELETE collection (bulk) → plural", () => {
    expect(
      normalizeOperationId("delete", "/api/0/organizations/{org}/detectors/"),
    ).toBe("deleteOrganizationDetectors");
  });

  it("converts kebab-case path segments to camelCase", () => {
    expect(
      normalizeOperationId(
        "get",
        "/api/0/organizations/{org}/events-timeseries/",
      ),
    ).toBe("listOrganizationEventsTimeseries");
    expect(
      normalizeOperationId(
        "get",
        "/api/0/organizations/{org}/release-threshold-statuses/",
      ),
    ).toBe("listOrganizationReleaseThresholdStatuses");
  });

  it("handles uppercase letters after a hyphen", () => {
    expect(normalizeOperationId("get", "/api/0/foo-Bar/")).toBe("listFooBar");
  });

  it("converts underscores in path segments to camelCase", () => {
    expect(normalizeOperationId("get", "/api/0/organizations/{org}/stats_v2/")).toBe(
      "listOrganizationStatsV2",
    );
    expect(normalizeOperationId("get", "/api/0/organizations/{org}/relay_usage/")).toBe(
      "listOrganizationRelayUsage",
    );
  });

  it("handles multi-level nesting", () => {
    expect(
      normalizeOperationId(
        "get",
        "/api/0/projects/{org}/{project}/keys/",
      ),
    ).toBe("listProjectKeys");
    expect(
      normalizeOperationId(
        "get",
        "/api/0/projects/{org}/{project}/keys/{id}/",
      ),
    ).toBe("getProjectKey");
  });

  it("singularizes parent segments that precede a path param", () => {
    expect(
      normalizeOperationId("get", "/api/0/organizations/{org}/issues/"),
    ).toBe("listOrganizationIssues");
    expect(
      normalizeOperationId(
        "get",
        "/api/0/organizations/{org}/issues/{id}/events/",
      ),
    ).toBe("listOrganizationIssueEvents");
  });

  it("handles consecutive params (/projects/{org}/{project}/)", () => {
    expect(
      normalizeOperationId("get", "/api/0/projects/{org}/{project}/"),
    ).toBe("getProject");
  });

  it("handles paths not under /api/0/ prefix", () => {
    expect(normalizeOperationId("get", "/custom/resources/")).toBe(
      "listCustomResources",
    );
  });

  it("trailing slash presence does not affect the result", () => {
    expect(normalizeOperationId("get", "/api/0/organizations")).toBe(
      "listOrganizations",
    );
    expect(normalizeOperationId("get", "/api/0/organizations/")).toBe(
      "listOrganizations",
    );
  });

  it("throws when path has no static segments", () => {
    expect(() => normalizeOperationId("get", "/api/0/{id}/")).toThrow(
      /no static segments/,
    );
  });

  it("throws on degenerate all-param path", () => {
    expect(() => normalizeOperationId("get", "/api/0/{a}/{b}/")).toThrow(
      /no static segments/,
    );
  });
});

// ---------------------------------------------------------------------------
// normalizeSpec — collision detection
// ---------------------------------------------------------------------------

describe("normalizeSpec collision detection", () => {
  function writeSpec(paths: Record<string, Record<string, unknown>>) {
    const tmp = join(tmpdir(), `test-spec-${Date.now()}.json`);
    writeFileSync(tmp, JSON.stringify({ paths }));
    return tmp;
  }

  it("throws when two different paths normalize to the same name", () => {
    // /api/0/x-y/ and /api/0/xY/ both produce "listXY" after kebab→camelCase.
    const input = writeSpec({
      "/api/0/x-y/": { get: { operationId: "List X Y" } },
      "/api/0/xY/": { get: { operationId: "List XY" } },
    });
    const output = join(tmpdir(), `out-${Date.now()}.json`);
    expect(() => normalizeSpec(input, output)).toThrow(/collision/);
    unlinkSync(input);
    try { unlinkSync(output); } catch {}
  });

  it("throws when a clean identifier collides with a path-derived one", () => {
    // Pre-existing clean IDs must be tracked: if path A has operationId
    // "listOrganizationIssues" (clean) and path B sentence-style normalizes to
    // the same name, that's a collision even though B's ID was a sentence.
    const input = writeSpec({
      "/api/0/something/": {
        // Manually set to the same name that the other path would generate.
        get: { operationId: "listOrganizationIssues" },
      },
      "/api/0/organizations/{org}/issues/": {
        // Sentence-style → normalizes to "listOrganizationIssues".
        get: { operationId: "List An Organization's Issues" },
      },
    });
    const output = join(tmpdir(), `out-${Date.now()}.json`);
    expect(() => normalizeSpec(input, output)).toThrow(/collision/);
    unlinkSync(input);
    try { unlinkSync(output); } catch {}
  });

  it("does not throw when operationIds are already clean identifiers", () => {
    const input = writeSpec({
      "/api/0/organizations/": {
        get: { operationId: "listOrganizations" }, // already clean — skipped
      },
    });
    const output = join(tmpdir(), `out-${Date.now()}.json`);
    expect(() => normalizeSpec(input, output)).not.toThrow();
    unlinkSync(input);
    try { unlinkSync(output); } catch {}
  });

  it("rewrites sentence-style operationIds and leaves clean ones alone", () => {
    const input = writeSpec({
      "/api/0/organizations/": {
        get: { operationId: "List Your Organizations" },
        post: { operationId: "createOrganization" }, // already clean
      },
    });
    const output = join(tmpdir(), `out-${Date.now()}.json`);
    normalizeSpec(input, output);
    const result = JSON.parse(readFileSync(output, "utf8"));
    expect(result.paths["/api/0/organizations/"].get.operationId).toBe(
      "listOrganizations",
    );
    expect(result.paths["/api/0/organizations/"].post.operationId).toBe(
      "createOrganization", // untouched
    );
    unlinkSync(input);
    unlinkSync(output);
  });
});
