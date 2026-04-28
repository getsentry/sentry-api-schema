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

Sentry uses cursor-based pagination via `Link` headers. Use `paginateAll` to collect all pages:

```ts
import { paginateAll, listAnOrganization_sProjects } from "@sentry/api";

const projects = await paginateAll(
  (cursor) => listAnOrganization_sProjects({
    baseUrl: "https://sentry.io",
    headers: { Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}` },
    path: { organization_id_or_slug: "my-org" },
    query: { cursor },
  }),
  "listAnOrganization_sProjects",
);
```

`unwrapPaginatedResult` and `parseSentryLinkHeader` are also exported for manual pagination.

## Schema source

The OpenAPI schema is synced from [`getsentry/sentry`](https://github.com/getsentry/sentry/tree/master/api-docs). Schema fixes belong there; build/tooling changes belong here.

## License

FSL-1.1-Apache-2.0. See [LICENSE.md](LICENSE.md).
