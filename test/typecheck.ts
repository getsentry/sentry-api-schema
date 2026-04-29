/**
 * Compile-time type checks for the generated wrappers.
 *
 * This file is type-checked but never executed. It asserts that the
 * generated wrappers preserve type information at the consumer boundary —
 * specifically:
 *   1. Path/query/body params remain typed.
 *   2. The cursor parameter is rejected from `query` (managed by the helper).
 *   3. The return type is the correct response shape (Array vs compound).
 *
 * If this file ever fails `tsc --noEmit`, the generator has regressed.
 */

import {
  fetchPage_deprecatedListAnOrganization_sMetricAlertRules,
  fetchPage_listAnOrganization_sIssues,
  fetchPage_listAnOrganization_sProjects,
  fetchPage_listClickedNodes,
  paginateAll_listAnOrganization_sIssues,
  paginateAll_listAnOrganization_sProjects,
  paginateUpTo_listAnOrganization_sIssues,
} from "../src/index";

const config = {
  baseUrl: "https://sentry.io",
  headers: { Authorization: "Bearer test" },
};

// =====================================================================
// fetchPage — array-shaped op
// =====================================================================

async function fetchPageHappyPath() {
  const result = await fetchPage_listAnOrganization_sIssues({
    ...config,
    path: { organization_id_or_slug: "my-org" },
    query: {
      // collapse should be allowed (not the cursor we manage)
      collapse: ["stats"],
      limit: 25,
    },
  });
  // Return type is PaginatedResponse<TArrayShape>; data is the array
  // (whose element type is the issue object the SDK declares).
  result.data.length;
  // nextCursor / prevCursor are typed strings | undefined
  if (result.nextCursor) {
    const _: string = result.nextCursor;
  }
}

async function fetchPageRejectsCursor() {
  await fetchPage_listAnOrganization_sIssues({
    ...config,
    path: { organization_id_or_slug: "my-org" },
    query: {
      // @ts-expect-error — `cursor` must NOT be passable here (helper-managed)
      cursor: "abc",
    },
  });
}

async function fetchPageRequiresPath() {
  // @ts-expect-error — required path param must still be required
  await fetchPage_listAnOrganization_sIssues({
    ...config,
    query: { limit: 25 },
  });
}

// =====================================================================
// paginateAll / paginateUpTo — array-shaped op
// =====================================================================

async function paginateAllHappyPath() {
  const items = await paginateAll_listAnOrganization_sIssues({
    ...config,
    path: { organization_id_or_slug: "my-org" },
    query: { limit: 100 },
  });
  // Return type is the array directly, not a wrapper
  items.length;
}

async function paginateUpToHappyPath() {
  const result = await paginateUpTo_listAnOrganization_sIssues(
    {
      ...config,
      path: { organization_id_or_slug: "my-org" },
      query: { limit: 100 },
    },
    { limit: 250, onPage: (n, t) => console.log(n, t) },
  );
  result.data.length;
  if (result.nextCursor) {
    const _: string = result.nextCursor;
  }
}

// =====================================================================
// fetchPage — compound-shaped op
// =====================================================================

async function fetchPageCompoundOp() {
  const result = await fetchPage_listClickedNodes({
    ...config,
    path: {
      organization_id_or_slug: "my-org",
      project_id_or_slug: "my-proj",
      replay_id: "00000000-0000-0000-0000-000000000000",
    },
  });
  // Compound 200 shape — `data` is whatever the spec declared (object,
  // not Array). We just assert it's not `unknown` by accessing it.
  void result.data;
}

// =====================================================================
// per_page widening — undocumented but runtime-supported
// =====================================================================

async function perPageAcceptedEvenWhenSpecOmitsIt() {
  // /organizations/{org}/projects/ has only `cursor` declared in the spec,
  // but the runtime accepts `per_page`. PaginationQuery widens with it so
  // callers don't need an `as` cast.
  await paginateAll_listAnOrganization_sProjects({
    ...config,
    path: { organization_id_or_slug: "my-org" },
    query: { per_page: 100 },
  });

  // Same for fetchPage on issues — per_page co-exists with documented
  // params (collapse, limit, sort, etc.).
  await fetchPage_listAnOrganization_sProjects({
    ...config,
    path: { organization_id_or_slug: "my-org" },
    query: { per_page: 100 },
  });
}

// =====================================================================
// Allow-list: spec-incomplete operations get wrappers anyway
// =====================================================================

async function metricAlertsWrapperExists() {
  // /alert-rules/ has `query?: never` in the spec (no cursor declared),
  // but the PAGINATED_BUT_UNMARKED allow-list emits wrappers. Callers
  // can pass per_page (added by PaginationQuery) and cursor is managed.
  const result = await fetchPage_deprecatedListAnOrganization_sMetricAlertRules({
    ...config,
    path: { organization_id_or_slug: "my-org" },
    query: { per_page: 50 },
  });
  void result.data;
}

// =====================================================================
// keepCursorOnOvershoot — opt-in option for endpoints with no per_page
// =====================================================================

async function paginateUpToKeepCursorOnOvershoot() {
  // For /issues/{id}/events/ (and any endpoint with no server-side
  // per_page), passing keepCursorOnOvershoot:true preserves access to
  // trimmed-tail items via the same cursor on the next call.
  const result = await paginateUpTo_listAnOrganization_sIssues(
    {
      ...config,
      path: { organization_id_or_slug: "my-org" },
    },
    {
      limit: 250,
      keepCursorOnOvershoot: true,
    },
  );
  void result.data;
  if (result.nextCursor) {
    const _: string = result.nextCursor;
  }
}

void fetchPageHappyPath;
void fetchPageRejectsCursor;
void fetchPageRequiresPath;
void paginateAllHappyPath;
void paginateUpToHappyPath;
void fetchPageCompoundOp;
void perPageAcceptedEvenWhenSpecOmitsIt;
void metricAlertsWrapperExists;
void paginateUpToKeepCursorOnOvershoot;
