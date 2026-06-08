import { describe, expect, it } from "bun:test";
import {
  normalizeOperationId,
  singularize,
} from "../lib/normalize-spec.mjs";

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

  it("correctly singularizes releases (regression: ses rule must not apply)", () => {
    expect(singularize("releases")).toBe("release");
  });

  it("leaves words ending in -ss, -us, -is untouched", () => {
    expect(singularize("class")).toBe("class");
    expect(singularize("status")).toBe("status"); // in irregular, but also ends in -us
    expect(singularize("analysis")).toBe("analysis");
  });

  it("leaves already-singular words untouched", () => {
    expect(singularize("event")).toBe("event");
    expect(singularize("monitor")).toBe("monitor");
  });
});

describe("normalizeOperationId", () => {
  // Collection GETs → list + plural
  it("GET collection → list", () => {
    expect(normalizeOperationId("get", "/api/0/organizations/")).toBe(
      "listOrganizations",
    );
    expect(
      normalizeOperationId(
        "get",
        "/api/0/organizations/{organization_id_or_slug}/issues/",
      ),
    ).toBe("listOrganizationIssues");
    expect(
      normalizeOperationId(
        "get",
        "/api/0/organizations/{organization_id_or_slug}/issues/{issue_id}/events/",
      ),
    ).toBe("listOrganizationIssueEvents");
  });

  // Detail GETs → get + singular
  it("GET detail (ends in param) → get + singularized", () => {
    expect(
      normalizeOperationId(
        "get",
        "/api/0/organizations/{organization_id_or_slug}/",
      ),
    ).toBe("getOrganization");
    expect(
      normalizeOperationId(
        "get",
        "/api/0/organizations/{organization_id_or_slug}/issues/{issue_id}/",
      ),
    ).toBe("getOrganizationIssue");
    expect(
      normalizeOperationId(
        "get",
        "/api/0/organizations/{organization_id_or_slug}/dashboards/{dashboard_id}/",
      ),
    ).toBe("getOrganizationDashboard");
  });

  // POST → create + singular
  it("POST → create + singularized last segment", () => {
    expect(
      normalizeOperationId(
        "post",
        "/api/0/organizations/{organization_id_or_slug}/dashboards/",
      ),
    ).toBe("createOrganizationDashboard");
    expect(
      normalizeOperationId(
        "post",
        "/api/0/organizations/{organization_id_or_slug}/teams/",
      ),
    ).toBe("createOrganizationTeam");
  });

  // PUT/PATCH → update
  it("PUT/PATCH → update", () => {
    expect(
      normalizeOperationId(
        "put",
        "/api/0/organizations/{organization_id_or_slug}/dashboards/{dashboard_id}/",
      ),
    ).toBe("updateOrganizationDashboard");
    expect(
      normalizeOperationId(
        "patch",
        "/api/0/organizations/{organization_id_or_slug}/issues/{issue_id}/",
      ),
    ).toBe("updateOrganizationIssue");
  });

  // DELETE detail → singular; DELETE collection → plural
  it("DELETE detail → singular", () => {
    expect(
      normalizeOperationId(
        "delete",
        "/api/0/organizations/{organization_id_or_slug}/dashboards/{dashboard_id}/",
      ),
    ).toBe("deleteOrganizationDashboard");
  });

  it("DELETE collection (bulk) → plural", () => {
    expect(
      normalizeOperationId(
        "delete",
        "/api/0/organizations/{organization_id_or_slug}/detectors/",
      ),
    ).toBe("deleteOrganizationDetectors");
  });

  // Hyphenated path segments → camelCase
  it("converts kebab-case path segments to camelCase", () => {
    expect(
      normalizeOperationId(
        "get",
        "/api/0/organizations/{organization_id_or_slug}/events-timeseries/",
      ),
    ).toBe("listOrganizationEventsTimeseries");
    expect(
      normalizeOperationId(
        "get",
        "/api/0/organizations/{organization_id_or_slug}/release-threshold-statuses/",
      ),
    ).toBe("listOrganizationReleaseThresholdStatuses");
  });

  // Nested paths
  it("handles multi-level nesting correctly", () => {
    expect(
      normalizeOperationId(
        "get",
        "/api/0/projects/{organization_id_or_slug}/{project_id_or_slug}/keys/",
      ),
    ).toBe("listProjectKeys");
    expect(
      normalizeOperationId(
        "get",
        "/api/0/projects/{organization_id_or_slug}/{project_id_or_slug}/keys/{key_id}/",
      ),
    ).toBe("getProjectKey");
  });

  // Parents singularized when followed by a param
  it("singularizes parent segments that precede a path param", () => {
    // organizations/{org}/ → organization (not organizations)
    expect(
      normalizeOperationId(
        "get",
        "/api/0/organizations/{organization_id_or_slug}/issues/",
      ),
    ).toBe("listOrganizationIssues");
    // issues/{id}/events/ → issue (not issues) in the resource name
    expect(
      normalizeOperationId(
        "get",
        "/api/0/organizations/{organization_id_or_slug}/issues/{issue_id}/events/",
      ),
    ).toBe("listOrganizationIssueEvents");
  });
});
