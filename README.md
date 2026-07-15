# @sentry/api

The official, auto-generated TypeScript client for Sentry's public REST API.

[![npm](https://img.shields.io/npm/v/@sentry/api.svg)](https://www.npmjs.com/package/@sentry/api)
[![license](https://img.shields.io/npm/l/@sentry/api.svg)](./LICENSE.md)

## Install

```bash
npm install @sentry/api
```

## Usage

Configure the client once, then call any operation without repeating auth or host.
`bearerToken(...)` is a pure factory that returns a config object; `client.setConfig(...)`
applies it to the global client.

```ts
import { client, bearerToken, listYourOrganizations } from "@sentry/api";

client.setConfig(bearerToken({ token: process.env.SENTRY_AUTH_TOKEN }));

const { data, error } = await listYourOrganizations();
if (error) throw error;
console.log(data);
```

`bearerToken` defaults `baseUrl` to `https://sentry.io`. For self-hosted, or to pin a single
region, pass your host:

```ts
client.setConfig(bearerToken({ token, baseUrl: "https://sentry.my-company.com" }));
```

### Isolated client (servers, tests)

`client.setConfig(...)` mutates a global singleton, which is convenient for a single-token CLI.
For a server that handles multiple tokens, or for tests, create an isolated instance with
`createSentryClient(...)` and pass it per call:

```ts
import { createSentryClient, bearerToken, listYourOrganizations } from "@sentry/api";

const sentry = createSentryClient(bearerToken({ token }));
const { data } = await listYourOrganizations({ client: sentry });
```

### Browser (Sentry frontend)

Use the `./browser` entry, which authenticates with the current session (cookies + CSRF),
same-origin:

```ts
import { client } from "@sentry/api";
import { browserSession } from "@sentry/api/browser";

client.setConfig(browserSession());
```

### Custom transport

`bearerToken` accepts a `fetch` option for transport policy the SDK does not own (token refresh,
retries, timeouts, custom CA, tracing). It also accepts `headers` (merged into every request) and
`throwOnError`.

You can always skip the factories and pass a raw config to `client.setConfig(...)`, or pass
`baseUrl`/`headers` on an individual call to override. Auth tokens and base URLs (including
self-hosted and region URLs) are documented at https://docs.sentry.io/api/auth/.

## Pagination

Sentry uses cursor-based pagination via `Link` headers. Every operation in the SDK that accepts a `cursor` query parameter has three auto-generated typed wrappers:

- `fetchPage_<operation>(options, cursor?)` — fetch a single page; returns `{ data, nextCursor?, prevCursor? }`.
- `paginateAll_<operation>(options, paginateOptions?)` — eagerly fetch all pages, returning the concatenated array. Bounded by `maxPages` (default 50) for safety. Available only for endpoints whose 200 response is `Array<...>`.
- `paginateUpTo_<operation>(options, paginateOptions)` — fetch up to a hard `limit` of items; suppresses `nextCursor` when the last page is trimmed (so callers resuming pagination won't skip records). Available only for endpoints whose 200 response is `Array<...>`.

The wrappers manage `cursor` for you — passing one in `query` is a type error. Every wrapper's `query` is also widened with an optional `per_page?: number` field, since Sentry's pagination framework accepts `per_page` on every cursor-paginated route at runtime even when the spec omits it.

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

By default, `paginateUpTo` drops `nextCursor` if the last fetched page had to be trimmed to fit `limit` — returning a cursor that points past the trimmed items would cause callers resuming pagination to skip records. For endpoints with no server-side `per_page` control (e.g. `/issues/{id}/events/`), pass `keepCursorOnOvershoot: true` to preserve the cursor; the trimmed-tail items remain reachable via the same cursor on the next call.

`nextCursor` is also dropped if `paginateUpTo` reaches `maxPages` (default 50) before fulfilling `limit` — raise `maxPages` to continue paginating.

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
