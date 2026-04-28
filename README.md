# @sentry/api

The official, auto-generated TypeScript client for Sentry's public REST API.

[![npm](https://img.shields.io/npm/v/@sentry/api.svg)](https://www.npmjs.com/package/@sentry/api)
[![license](https://img.shields.io/npm/l/@sentry/api.svg)](./LICENSE.md)

## Install

```bash
npm install @sentry/api
```

## Usage

```ts
import { client, listYourProjects } from "@sentry/api";

client.setConfig({
  baseUrl: "https://sentry.io",
  headers: { Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}` },
});

const { data, error } = await listYourProjects();
if (error) throw error;
console.log(data);
```

Auth tokens and base URLs (including self-hosted and region URLs) are documented at https://docs.sentry.io/api/auth/.

## Pagination

Sentry uses cursor-based pagination via `Link` headers. Use `paginateAll` to collect all pages:

```ts
import { paginateAll, listYourProjects } from "@sentry/api";

const all = await paginateAll(
  (cursor) => listYourProjects({ query: { cursor } }),
  "listYourProjects",
);
```

`unwrapPaginatedResult` and `parseSentryLinkHeader` are also exported for manual pagination.

## Schema source

The OpenAPI schema is synced from [`getsentry/sentry`](https://github.com/getsentry/sentry/tree/master/api-docs). Schema fixes belong there; build/tooling changes belong here.

## License

FSL-1.1-Apache-2.0. See [LICENSE.md](LICENSE.md).
