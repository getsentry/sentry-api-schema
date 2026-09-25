# Shared client design

This document records the intended contract for `@sentry/api` across the Sentry
CLI, MCP server, frontend, and external integrations. It separates the configuration
foundation in [#78](https://linear.review/getsentry/sentry-api-schema/pull/78) from
planned capabilities. It does not describe all of these capabilities as shipped.
The broader proposal is tracked in [#81](https://github.com/getsentry/sentry-api-schema/issues/81).

## Responsibility boundaries

The generated operations and types describe the backend API. Small optional SDK
helpers share API semantics such as authentication setup and pagination. Consumers
retain application policy: credential storage and refresh, tool output, UI state,
telemetry, and environment-specific transport configuration.

Factories are named by authentication method, such as `bearerToken` and
`browserSession`. Deployment and routing are configuration options, not additional
authentication modes. Plain configuration objects remain supported.

The SDK must be useful to external integrations without assuming a first-party
store, framework, process lifecycle, or Sentry frontend globals.

## Configuration foundation: #78

The current change provides:

- `bearerToken(...)`, a pure builder for token authentication and request defaults.
- `browserSession(...)` from `@sentry/api/browser`, for session cookies and CSRF.
- Access to the generated client and `createSentryClient(...)` for isolated clients.
- Composition with an existing `fetch` implementation and raw client configuration.

Calling a factory does not initialize a singleton or perform discovery. A caller
applies its result to a client. The global client is convenient for a single
configuration; servers handling multiple credentials use isolated clients.

No region discovery, region cache, URL builder, identity endpoint, retry wrapper,
or progressive-accuracy helper is introduced by this foundation.

## Deployment origin and routing

The configured `baseUrl` identifies the deployment the caller intends to contact.
Its origin must be preserved unless the caller explicitly enables a routing policy.
An Enterprise, self-hosted, or custom hostname must not be converted to public SaaS
because it shares a domain suffix. Browser requests default to their current origin.

For public SaaS, `https://sentry.io` is the default. The backend gateway can route
org-scoped operations using the organization in the path. An unknown organization
therefore does not require a preliminary lookup or a request to every region.

A known region belongs to an organization within a deployment and authentication
context. It is not a global setting for every operation made with that credential.
Concurrent requests for different organizations must not mutate shared `baseUrl`.

Control operations, including identity and global discovery, stay on the configured
control origin. Having an organization parameter does not alone establish that an
operation belongs in a regional silo. A client deliberately pinned to a region
cannot assume that the same origin provides global control operations.

Prefer org-scoped operations over legacy paths containing only a resource ID.
The latter can require an explicit regional context; the gateway fallback must not
be presented as sufficient for every historical API route.

Direct regional routing is an optional optimization. Avoiding a proxy hop is not
a measured latency improvement by itself; compare representative workloads before
making performance claims or enabling discovery by default.

## Planned resolver and cache ownership: #79

[#79](https://linear.review/getsentry/sentry-api-schema/pull/79) proposes optional
direct routing. Its implementation must be checked against the contract here;
the configuration foundation does not depend on it being complete.

There are three ownership modes:

| Mode | Resolver and storage owner | Request behavior |
| --- | --- | --- |
| Default | None | Use the configured origin and backend gateway. |
| SDK discovery, explicitly enabled | SDK client instance | Resolve and reuse an organization's regional origin. |
| Caller resolver | Consumer's existing store | Read supplied metadata without adding another SDK cache. |

SDK discovery uses a private in-memory cache and deduplicates concurrent lookups.
It must not install a process-global cache or persist credentials or routing data
to disk by default. The effective cache scope includes deployment, authentication
context, and organization. A per-instance map keyed by organization is sufficient
only when the first two remain fixed; reconfiguration must not reuse stale scope.

The proposed resolver currently retains successful and missing results for its
lifetime and evicts failures. Expiration or invalidation remains a follow-up design
requirement for long-lived clients and organization moves. It is not implemented
by #78. Missing data must not become a permanent assertion that no region exists.

A caller-supplied resolver should reuse information already held by the frontend,
CLI, or MCP. The SDK must not independently cache that callback's answer and create
a second source of truth. Seeding SDK discovery from known organization metadata is
a useful future capability; no seeding API is committed by this document.

When regional resolution is unavailable, org-scoped operations can use the
configured gateway origin. Resolution must not turn every ordinary API call into
mandatory discovery. Preserve failures that indicate invalid credentials or requests;
do not hide an API error by searching unrelated deployments or replaying mutations.

## Operation metadata and backend contracts

The backend owns endpoint definitions, organization context, and whether an
operation runs in control or a regional silo. Prefer generating routing capability
metadata from that source instead of maintaining a second route catalog or regex
inside the SDK. The exact schema extension and generated API remain to be designed.

The missing `/teams/{org}/...` case identified in routing review is a route-coverage
bug. Adding that prefix does not answer the separate question of which operations
are control-only. Both need explicit coverage before automatic routing is adopted.

Backend organization discovery already has a control implementation that lists
memberships across cells. Its rollout and supported deployment versions still need
verification when changing a consumer; current source alone is not deployment proof.
See the [organization endpoint](https://github.com/getsentry/sentry/blob/b4b356554798716ceaeab74efdc095782be9ca16/src/sentry/core/endpoints/organization_index.py)
and [gateway routing](https://github.com/getsentry/sentry/blob/b4b356554798716ceaeab74efdc095782be9ca16/src/sentry/hybridcloud/apigateway/apigateway.py).

## API origins, web links, and identity

API routing and human-facing links are separate contracts. Prefer an issue's
returned `permalink` over reconstructing its URL. Organization responses expose
`links.organizationUrl` and `links.regionUrl`; the regional API origin is not a
substitute for the organization's web URL or its path conventions.

The backend accounts for deployment configuration and customer-domain paths when
[constructing canonical links](https://github.com/getsentry/sentry/blob/b4b356554798716ceaeab74efdc095782be9ca16/src/sentry/organizations/absolute_url.py).
Any future shared link helper needs its own compatibility contract and tests.

`GET /api/0/auth/` is currently a private control operation. A consumer may retain
a small raw adapter when it needs that capability. Migrating public operations to
the SDK does not require changing the endpoint's publication policy or pretending
that a public generated identity operation exists.

## Consumer policy and later helpers

The frontend retains `ConfigStore`, admin behavior, dev-UI origin selection, and
query state, including cancellation and UI caching. The SDK can consume a resolver
or configured transport without importing those systems. CLI and MCP likewise keep
credential lifecycle and their own presentation and orchestration layers.

Token refresh, custom CA handling, telemetry, and existing retry policy continue to
compose through `fetch`. [#92](https://github.com/getsentry/sentry-api-schema/issues/92)
considers a shared opt-in transport retry helper. Its budget, eligible failures,
cancellation, and safe methods need a separate decision; mutation replay is not a
side effect of adopting client configuration.

[#80](https://linear.review/getsentry/sentry-api-schema/pull/80) proposes progressive
accuracy for partially scanned queries. That is a domain-specific second query,
distinct from transport retries. Backend schema coverage for sampling parameters
and consumer escalation rules belong with that work.

## Delivery sequence

1. Land the configuration foundation in #78 with focused package and contract tests.
2. Adopt it in a bounded MCP change: use an isolated client and migrate a coherent
   set of supported operations while retaining necessary consumer adapters.
3. Complete routing and cache decisions in #79 independently of that adoption.
4. Evaluate progressive accuracy (#80), transport retries (#92), link helpers, and
   identity coverage as separate changes with their own evidence and validation.

Existing PR stacking describes branch dependencies, not a requirement that MCP wait
for every helper. Each adoption should remove only the duplicated behavior replaced
by a verified SDK contract and retain tests for its supported deployment shapes.
