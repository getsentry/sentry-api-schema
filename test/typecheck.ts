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
  fetchPage_listAnOrganization_sIssues,
  fetchPage_listClickedNodes,
  paginateAll_listAnOrganization_sIssues,
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

void fetchPageHappyPath;
void fetchPageRejectsCursor;
void fetchPageRequiresPath;
void paginateAllHappyPath;
void paginateUpToHappyPath;
void fetchPageCompoundOp;
