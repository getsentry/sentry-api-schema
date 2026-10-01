# @sentry/api

The official, auto-generated TypeScript client for Sentry's public REST API.

[![npm](https://img.shields.io/npm/v/@sentry/api.svg)](https://www.npmjs.com/package/@sentry/api)
[![license](https://img.shields.io/npm/l/@sentry/api.svg)](./LICENSE.md)

## Install

```bash
npm install @sentry/api
```

## Usage

Configure a client once, then call its typed operation methods:

```ts
import { createSentryClient } from "@sentry/api";

const sentry = createSentryClient({
  baseUrl: "https://sentry.io",
  headers: { Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}` },
});

const { data, error } = await sentry.listOrganizations();

if (error !== undefined) throw error;
console.log(data);
```

Operation methods retain the generated documentation, typed arguments, and response types. Per-call options include `path`, `query`, `headers`, `signal`, and `throwOnError`. Results preserve the underlying `request` and `response`, including response headers:

```ts
const controller = new AbortController();

const { data: project, request, response } = await sentry.getProject({
  path: {
    organization_id_or_slug: "my-org",
    project_id_or_slug: "my-project",
  },
  signal: controller.signal,
  throwOnError: true,
});

console.log(project, request.url, response.headers.get("content-type"));
```

By default, operations return a `data`/`error` result. Set `throwOnError: true` to reject on errors, as above. Methods are bound to their instance and can be safely destructured, such as `const { getProject } = sentry`.

Each `createSentryClient` call creates an independent transport configuration. The root entry also exports the `SentryClient` and `Config` types; `Config` is the underlying transport's configuration type. Access that transport as `sentry.client` for interceptors, configuration updates, or low-level requests.

Supply the base URL and authentication appropriate for your deployment. See Sentry's [API authentication documentation](https://docs.sentry.io/api/auth/).

### Standalone operations

Individual operation functions remain available as a modular alternative and accept transport configuration directly:

```ts
import { listOrganizations } from "@sentry/api";

const { data, error } = await listOrganizations({
  baseUrl: "https://sentry.io",
  headers: { Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}` },
});
```

They can also reuse an existing instance's configuration: `listOrganizations({ client: sentry.client })`.

### Browser sessions

The browser helper configures session cookies and CSRF token injection:

```ts
import { createSentryClient } from "@sentry/api";
import { createBrowserSdkConfig } from "@sentry/api/browser";

const sentry = createSentryClient(
  createBrowserSdkConfig({ baseUrl: "https://sentry.example.com" }),
);

const { data, error } = await sentry.listOrganizations();
```

## Runtime validation

The root `@sentry/api` entry has no runtime dependencies. It provides the API client and pure TypeScript types without installing a validation library.

Valibot 1 runtime schemas are available through a separate optional entry point:

```bash
npm install @sentry/api valibot
```

```ts
import * as v from "valibot";
import { vGetProjectResponse } from "@sentry/api/valibot";

const project = v.parse(vGetProjectResponse, input);
```

The existing Zod 3 entry remains supported:

```bash
npm install @sentry/api zod
```

```ts
import { zGetProjectResponse } from "@sentry/api/zod";

const project = zGetProjectResponse.parse(input);
```

`valibot` and `zod` are optional peer dependencies. Install neither when you only need the generated client and TypeScript types, or install the validator used by your application. The `@sentry/api/valibot` entry requires Valibot 1; its optional peer uses a wildcard because npm applies peer constraints to the whole package, including consumers that never import this entry.

## Error handling

Every operation with documented error responses has a generated `narrowError_<operation>` wrapper. It returns data or a `SentryApiError` that preserves the operation's status-to-body type map. These wrappers remain standalone functions; pass `sentry.client` to reuse the client configured above:

```ts
import { narrowError_getProject } from "@sentry/api";

const result = await narrowError_getProject({
  client: sentry.client,
  path: {
    organization_id_or_slug: "my-org",
    project_id_or_slug: "my-project",
  },
});

if (!result.ok) {
  if (!result.error.documented) {
    // Unexpected HTTP status or a transport failure.
    throw result.error;
  }

  switch (result.error.status) {
    case 403:
    case 404:
      throw result.error;
  }
}
```

Checking `documented` first separates the operation's finite error union from unexpected statuses and transport failures. Within the documented branch, checking `status` narrows `body` to that response's schema. Error bodies remain `unknown` where the source OpenAPI response has no schema.

## Pagination

Sentry uses cursor-based pagination via `Link` headers. Choose one of three helpers on your configured client:

| Task | Method | Result |
| --- | --- | --- |
| Display one page, with previous/next navigation | `sentry.fetchPage.<operation>(options, cursor?)` | `{ data, response, nextCursor?, prevCursor? }` |
| Collect up to an item limit | `sentry.paginateUpTo.<operation>(options, { limit, ... })` | `{ data, stopReason, nextCursor? }` |
| Explicitly collect pages eagerly | `sentry.paginateAll.<operation>(options, { maxPages?, startCursor? }?)` | `{ data, stopReason, nextCursor? }` |

`fetchPage` is available for operations whose schema declares a `cursor` query parameter. Collection helpers are available only when the operation's 200 response is an array. Compound response bodies remain intact. Ordinary operation methods such as `sentry.listOrganizations()` still make just one request.

All helpers reuse the instance's configuration and interceptors and can be destructured. They manage `cursor` separately from `query`, retaining your path, filters, and `signal` while invoking the configured operation. The SDK does not own page history or a response cache: the consumer keeps cursors in its URL, query cache, or persistent storage.

Pagination needs the transport's default `responseStyle: "fields"` to read HTTP headers; `responseStyle: "data"` is not supported. Helpers reject on failure: under the default error policy, they throw `SentryApiError`; if the transport is configured with `throwOnError: true`, its thrown error propagates directly.

### Single page

```ts
const options = {
  path: { organization_id_or_slug: "my-org" },
  query: { query: "is:unresolved", limit: 25 },
};

const page = await sentry.fetchPage.listOrganizationIssues(options);
console.log(page.data, page.response.headers.get("X-Hits"));

if (page.nextCursor !== undefined) {
  const nextPage = await sentry.fetchPage.listOrganizationIssues(options, page.nextCursor);
  // Keep nextPage.prevCursor to navigate back when the user requests it.
}
```

Each page preserves its own raw `Response`, including status and headers. The transport has already read the body; use `page.data` for the parsed result. Code that constructs a `PaginatedResponse<T>` manually, such as test fixtures, must now supply its `response` field.

### Bounded collection

```ts
const options = { path: { organization_id_or_slug: "my-org" } };
const batch = await sentry.paginateUpTo.listOrganizationIssues(options, {
  limit: 250,
  maxPages: 5,
});
// Requests 100 + 100 + 50 when the server returns full pages.
console.log(batch.data, batch.stopReason);

if (batch.nextCursor !== undefined) {
  const next = await sentry.paginateUpTo.listOrganizationIssues(options, {
    limit: 250,
    startCursor: batch.nextCursor,
  });
}
```

Automatic sizing is deliberately limited to operations whose forward cursors have been verified to support changing page size:

| Operation | HTTP size parameter | Maximum per request |
| --- | --- | --- |
| `listOrganizationIssues`, `listProjectIssues` | `limit` | 100 |
| `listOrganizationIssueEvents` | `per_page` | 100; 10 with `full: true` |

Each request uses the smallest of the remaining item budget, the caller's requested page size (if supplied), and the verified maximum. Other operations retain their query options unchanged. In particular, **projects do not use 100 + 100 + 50**: their backend `OffsetPaginator` includes the page size in its cursor, and resizing mid-traversal can skip rows. Declaring `per_page` in the schema is not enough to enable resizing.

If a server ignores the size or an operation cannot be resized, the helper trims any excess rows and omits the unsafe cursor. It reports `stopReason: "limit"`, even if that was the server's last page. Use `fetchPage` when every row and each page's headers must be retained.

### Eager collection and completion

```ts
const projects = await sentry.paginateAll.listOrganizationProjects(
  { path: { organization_id_or_slug: "my-org" } },
  { maxPages: 50 },
);
console.log(projects.data, projects.stopReason);
// If stopReason is "maxPages", projects.nextCursor resumes traversal.
```

Both collection helpers return `PaginatedCollection<TItem>`:

| `stopReason` | Meaning | `nextCursor` |
| --- | --- | --- |
| `"exhausted"` | All fetched rows were returned and the server advertises no next page | Absent |
| `"limit"` | The item budget stopped collection | Present only when no rows were discarded |
| `"maxPages"` | The request cap stopped collection while more pages exist | Present |

Only `stopReason === "exhausted"` means complete. If the final server page exactly fills the item budget, exhaustion takes precedence. A missing cursor alone does not mean complete.

`maxPages` defaults to 50 for both helpers. `limit` and `maxPages` must be positive safe integers. Resume forward from a returned `nextCursor`, keeping the same operation, filters, and page-size options; cursors stay opaque. SDK calls do not retain a history or snapshot the collection against concurrent server changes. Errors and cancellation reject the collection call, including after earlier pages succeeded.

Collection results have no single `response`: their data may come from several HTTP requests. Frontend tables and infinite queries can keep using `fetchPage` with their own URL/cache state. CLI history, MCP output budgets, and TanStack adapters remain consumer integrations tracked in [#99](https://github.com/getsentry/sentry-api-schema/issues/99).

### Migration from earlier 0.x helpers

```ts
// Before: const projects = await sentry.paginateAll.listOrganizationProjects(options);
const { data: projects, stopReason, nextCursor } =
  await sentry.paginateAll.listOrganizationProjects(options);
```

`paginateAll` now returns a collection object instead of an array, for bound, standalone, and generic helpers. `paginateUpTo` adds `stopReason` and preserves safe continuation at `maxPages`. The unsafe `keepCursorOnOvershoot` option has been removed; no cursor may skip discarded rows. Invalid item/request budgets now reject before fetching.

### Standalone pagination

All existing imports remain available and share the same implementation and result types:

```ts
import { fetchPage_listOrganizationProjects } from "@sentry/api";

const page = await fetchPage_listOrganizationProjects({
  client: sentry.client,
  path: { organization_id_or_slug: "my-org" },
});
console.log(page.response.headers.get("Link"));
```

The corresponding `paginateUpTo_<operation>` and `paginateAll_<operation>` imports remain supported. Existing helpers accept `per_page` in their query options even where the schema omits it; choose page-size parameters supported by your endpoint.

### Generic pagination helpers

The same low-level helpers used by the generated wrappers are also exported for advanced use cases:

- `parseSentryLinkHeader(header)` — `{ nextCursor?, prevCursor? }`
- `unwrapResult(sdkResult, context)` — throw-on-error data unwrap
- `unwrapPaginatedResult(sdkResult, context)` — same but with cursors
- `fetchPage`, `paginateAll`, `paginateUpTo` — generic versions taking a fetcher thunk

A generic `paginateUpTo` fetcher receives `(cursor, remaining)`. Existing cursor-only fetchers still work; use `remaining` only when your endpoint's cursor supports resizing. The generated wrappers apply the verified rules above for you.

## Schema source

The OpenAPI schema is synced from [`getsentry/sentry`](https://github.com/getsentry/sentry/tree/master/api-docs). Schema fixes belong there; build/tooling changes belong here.

## License

FSL-1.1-Apache-2.0. See [LICENSE.md](LICENSE.md).
