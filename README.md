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
| Collect up to an item limit | `sentry.paginateUpTo.<operation>(options, { limit, ... })` | `{ data, nextCursor? }` |
| Explicitly collect pages eagerly | `sentry.paginateAll.<operation>(options, { maxPages? }?)` | Concatenated array; stops at `maxPages` (default 50) |

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
const batch = await sentry.paginateUpTo.listOrganizationProjects(
  {
    path: { organization_id_or_slug: "my-org" },
    query: { per_page: 50 },
  },
  { limit: 250 },
);

console.log(batch.data, batch.nextCursor);
```

The total item limit and the HTTP page size are separate. Currently the helper uses the same requested page size for each request. If the last page overshoots the item limit, it trims the data and suppresses `nextCursor` by default to avoid skipping the discarded rows. The example uses 50-item HTTP pages for a 250-item budget.

### Eager collection

```ts
const projects = await sentry.paginateAll.listOrganizationProjects(
  { path: { organization_id_or_slug: "my-org" } },
  { maxPages: 50 },
);
```

Collection results do not expose a single `response`: their data can come from several HTTP requests. Use `fetchPage` when you need each page's headers or incremental loading.

### Current collection limits

The bound methods preserve the existing helpers' behavior. `paginateAll` can return an incomplete array when it reaches `maxPages`, without identifying that condition. `paginateUpTo` also drops `nextCursor` when that cap is reached, so its absence does not prove the collection is exhausted. Use explicit page traversal when you need reliable exhaustion detection today.

Operation-aware page sizing and explicit completion/continuation metadata are tracked in [#99](https://github.com/getsentry/sentry-api-schema/issues/99). Frontend query adapters and CLI navigation integration are also follow-up work. The existing `keepCursorOnOvershoot` escape hatch remains available for compatibility; its safety depends on the endpoint's cursor semantics.

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

## Schema source

The OpenAPI schema is synced from [`getsentry/sentry`](https://github.com/getsentry/sentry/tree/master/api-docs). Schema fixes belong there; build/tooling changes belong here.

## License

FSL-1.1-Apache-2.0. See [LICENSE.md](LICENSE.md).
