# @sentry/api

The official, auto-generated TypeScript client for Sentry's public REST API.

[![npm](https://img.shields.io/npm/v/@sentry/api.svg)](https://www.npmjs.com/package/@sentry/api)
[![license](https://img.shields.io/npm/l/@sentry/api.svg)](./LICENSE.md)

## Install

```bash
npm install @sentry/api
```

## Usage

Pass `baseUrl` and an auth header to each call:

```ts
import { listYourOrganizations } from "@sentry/api";

const { data, error } = await listYourOrganizations({
  baseUrl: "https://sentry.io",
  headers: { Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}` },
});

if (error) throw error;
console.log(data);
```

Auth tokens and base URLs (including self-hosted and region URLs) are documented at https://docs.sentry.io/api/auth/.

## Pagination

Sentry uses cursor-based pagination via `Link` headers. Every operation in the SDK that accepts a `cursor` query parameter has three auto-generated typed wrappers:

- `fetchPage_<operation>(options, cursor?)` — fetch a single page; returns `{ data, nextCursor?, prevCursor? }`.
- `paginateAll_<operation>(options, paginateOptions?)` — eagerly fetch all pages, returning the concatenated array. Bounded by `maxPages` (default 50) for safety. Available only for endpoints whose 200 response is `Array<...>`.
- `paginateUpTo_<operation>(options, paginateOptions)` — fetch up to a hard `limit` of items; suppresses `nextCursor` when the last page is trimmed (so callers resuming pagination won't skip records). Available only for endpoints whose 200 response is `Array<...>`.

The wrappers manage `cursor` for you — passing one in `query` is a type error.

### Single page

```ts
import { fetchPage_listAnOrganization_sIssues } from "@sentry/api";

const { data, nextCursor } = await fetchPage_listAnOrganization_sIssues({
  baseUrl: "https://sentry.io",
  headers: { Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}` },
  path: { organization_id_or_slug: "my-org" },
  query: { collapse: ["stats"], limit: 25 },
});
```

### All pages

```ts
import { paginateAll_listAnOrganization_sProjects } from "@sentry/api";

const projects = await paginateAll_listAnOrganization_sProjects({
  baseUrl: "https://sentry.io",
  headers: { Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}` },
  path: { organization_id_or_slug: "my-org" },
});
```

### Bounded pagination

```ts
import { paginateUpTo_listAnOrganization_sIssues } from "@sentry/api";

const { data, nextCursor } = await paginateUpTo_listAnOrganization_sIssues(
  {
    baseUrl: "https://sentry.io",
    headers: { Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}` },
    path: { organization_id_or_slug: "my-org" },
    query: { limit: 100 },
  },
  {
    limit: 250,
    onPage: (fetched, target) => console.log(`fetched ${fetched}/${target}`),
  },
);
```

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
