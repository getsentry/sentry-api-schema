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

const result = await sentry.listOrganizations();

if ("error" in result) throw result.error;
console.log(result.data);
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

Operations always return `fields`: `{ data, request, response }` on success, or `{ error, request, response }` on failure. A failure without an HTTP response has `response: undefined`. Check `"error" in result`, since a custom error can itself be `undefined`. Received headers are in `response.headers`; outgoing headers are in `request.headers`.

Set `throwOnError: true` to reject on failures while keeping the same success fields. Methods are bound to their instance and can be safely destructured, such as `const { getProject } = sentry`. Types narrow to success when `true` is supplied **per call**; calls that inherit mutable client configuration conservatively retain the result union.

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

### Query parameter types

Each operation's `<Operation>Data` type describes its `path`, `query`, and `body`. Enum-valued query parameters also get a named type for one value, `<Operation>Query<Parameter>`. For array parameters, that is the element type:

```ts
import type {
  ListOrganizationTraceItemAttributesQueryAttributeType,
  ListOrganizationTraceItemAttributesQueryDataset,
} from "@sentry/api";

const dataset: ListOrganizationTraceItemAttributesQueryDataset = "spans";
const types: ListOrganizationTraceItemAttributesQueryAttributeType[] = ["string", "number"];
```

### Query defaults

A few operations send a query parameter by default to skip expensive work most callers don't need. The operation's documentation states the default.

| Operation | Default | Effect |
| --- | --- | --- |
| `getOrganizationIssueEvent` | `collapse: ["adjacentEvents"]` | Skips the next/previous event lookups; `nextEventID` and `previousEventID` are `null` |
| `getProjectEvent` | `collapse: ["adjacentEvents"]` | Skips the next/previous event lookups; `nextEventID` and `previousEventID` are `null` |

The default applies only when the parameter is omitted or `undefined`. Any value you pass replaces it, and an empty list sends nothing:

```ts
const path = { organization_id_or_slug: "my-org", issue_id: "123", event_id: "latest" } as const;

await sentry.getOrganizationIssueEvent({ path }); // ?collapse=adjacentEvents
await sentry.getOrganizationIssueEvent({ path, query: { collapse: [] } }); // includes nextEventID/previousEventID
```

Standalone operations, bound methods, and `narrowError_*` wrappers behave the same way. The operation catalog describes the API itself, so it does not list these defaults.

### Operation discovery

`@sentry/api/operations` exports a readonly catalog for offline discovery, without importing the client, validators, or transport:

```ts
import { operations } from "@sentry/api/operations";

const logOperations = operations.filter(operation =>
  operation.queryParameters.some(parameter =>
    parameter.name === "dataset" && parameter.enum?.includes("logs"),
  ),
);
console.log(logOperations.map(({ functionName, method, path }) => ({ functionName, method, path })));
```

Each `ApiOperation` records the actual exported `functionName`, original OpenAPI `operationId`, method, path, summary, description, tags, path parameter names, query metadata, explicit deprecation flag, and `idempotent` flag. `ApiQueryParameter` includes the name, required flag, description, type, and declared enum values (item values for arrays). Operation parameters override inherited path parameters.

`idempotent` tells retrying clients whether resending an identical request after a timeout or 5xx response is safe. It is always `true` for `GET`, `HEAD`, `OPTIONS`, and `TRACE`. Other methods are `true` only when Sentry marks the operation with the `x-sentry-idempotent` OpenAPI extension; `false` means not known to be idempotent, not known to be unsafe.

The catalog is generated from the same schema and SDK output as each release. Consumers own search, grouping, ranking, and command aliases; the catalog does not fetch a live schema or infer undocumented API behavior.

### Build-time source analysis

`@sentry/api/source-analysis` follows references in supplied TypeScript source to discover calls to catalog operations. Install TypeScript only when using this optional build tool; the analyzer is tested with TypeScript 5.9. Its optional peer uses a wildcard so it does not constrain the compiler used by applications that only import the client.

```bash
npm install --save-dev @sentry/api typescript@^5.9
```

```ts
import { operations } from "@sentry/api/operations";
import { analyzeSourceApiUsage } from "@sentry/api/source-analysis";

const sources = new Map([
  ["features/logs.ts", `
    import { listOrganizationEvents } from "@sentry/api";
    export const readLogs = () =>
      listOrganizationEvents({
        path: { organization_id_or_slug: "example-org" },
        query: { dataset: "logs", field: ["message"] },
      });
  `],
]);
const analysis = analyzeSourceApiUsage(sources, operations, {
  queryParameters: ["dataset"],
});
console.log(analysis.exports.get("features/logs.ts")?.get("readLogs")?.operations);
// Includes listOrganizationEvents with known query context { dataset: "logs" }.
```

The analyzer parses source without executing it, following local imports, re-exports, aliases, and references. Supply sources together with the operation catalog from the installed SDK version. Run it during the consumer's build: command-to-operation relationships depend on consumer code and cannot be precomputed during SDK packaging.

Named, namespace, and default imports are supported, along with top-level functions, variable initializers, and default function/expression exports. Relative imports resolve only against the supplied sources. Extensionless paths try the exact file, `.ts`, `.tsx`, `index.ts`, then `index.tsx`; `.js` specifiers try `.ts` and `.tsx` before the exact `.js` file. Explicit `.ts`/`.tsx` specifiers use the exact file. Named re-exports can forward a default; `export *` forwards only named exports.

Consumers configure their own `boundaries` (factory names whose arguments are inspected without following the factory implementation), `requests` (raw-request wrapper argument positions), `queryParameters` (query values to retain), and `declarationFlags` (boolean markers). These options default to empty lists. Returned `boundaries` identify factory-created exports and their markers; `methods` records reachable HTTP methods, including known methods on unresolved raw requests. CLI routing, aliases, presentation, and destructive-command policy remain with the consumer.

This is static discovery, not proof of runtime execution or safety. Class/member dispatch, dynamic imports, CommonJS, and `tsconfig` path aliases are outside its scope. Missing sources and unsupported constructs can omit calls, so an empty result does not prove that no API calls exist. `unresolvedRequests` contains diagnostics for raw requests that cannot be resolved against the public catalog, not source-coverage diagnostics. Unknown query values are omitted, mutable `let` and `var` bindings are left unknown, and a related operation does not describe every request a workflow makes. The entry imports TypeScript separately and is not loaded by the root client, browser helpers, or operation catalog.

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

### Cancellation and custom fetch

Reuse the client and supply an `AbortSignal` for each operation. The caller owns the signal, whether it comes from a command, an MCP tool call, or a query library:

```ts
const controller = new AbortController();
const pending = sentry.listOrganizations({
  signal: controller.signal,
  throwOnError: true,
});

// When this operation is no longer needed:
controller.abort();
await pending; // Rejects with the cancellation reason by default.
```

Cancellation does not affect other calls sharing the client. Immediately before invoking `fetch`, the SDK checks the final request's signal, including changes made by request interceptors. An already-aborted signal prevents dispatch; authentication, validation, and request interceptors may still run before that check.

A configured `fetch` receives a native `Request`; its method, body, headers, and signal need not appear in a separate `init` argument. Forward the request intact and preserve native `RequestInit` override semantics when wrapping another transport:

```ts
const sentry = createSentryClient({
  baseUrl: "https://sentry.io",
  fetch: (input, init) => fetch(input, init),
});
```

Your transport must honor the signal while a request is in flight. The SDK cannot force an arbitrary custom fetch or asynchronous hook to stop, and cancellation does not undo a server mutation that has already completed.

Cancellation follows the [error handling contract](#error-handling): before dispatch the SDK uses `signal.reason`; during fetch it preserves the transport's rejection, which may differ by runtime. By default this is returned as `{ error, request, response: undefined }`, or thrown with `throwOnError: true`. Error interceptors can intentionally map it. Cancellation during response body reading rejects unchanged, even in fields mode. There is no SDK-specific cancellation error class.

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

HTTP failures use `SentryApiError`, whether returned in `result.error` or thrown with `throwOnError: true`. It preserves the status, parsed `body`, exact `rawBody` text, `request`, and `response` (including headers). The transport reads the error body once; consumers do not need to clone or reread the response. Error bodies without valid JSON remain strings.

```ts
import { SentryApiError } from "@sentry/api";

const result = await sentry.listOrganizations();
if ("error" in result) {
  if (result.error instanceof SentryApiError) {
    console.log(result.error.status, result.error.body, result.error.rawBody);
    console.log(result.error.response?.headers.get("retry-after"));
  }
  throw result.error;
}
```

`error` is typed as `unknown`: a custom `fetch` or error interceptor can supply its own error. Fetch rejections, including cancellation, keep their original identity and have no HTTP response. They are returned or thrown according to `throwOnError`. Exceptions from serialization, validation, interceptors, or response body reading/decoding reject unchanged, even with `throwOnError: false`; that setting does not make a request exception-free.

### Custom errors

HTTP errors are normalized **before** error interceptors run. Interceptors run in registration order, each receiving the preceding interceptor's result. Their returned or thrown value is preserved by operations and pagination; there is no second normalization pass.

```ts
sentry.client.interceptors.error.use((error, response, request) => {
  if (error instanceof SentryApiError) {
    // Return your application's existing error type here, if needed.
    return new Error(`API ${error.status}: ${request.method} ${request.url}`, {
      cause: error,
    });
  }
  // No HTTP response for a rejected fetch. Preserve cancellation/custom errors.
  return error;
});
```

### Opt-in status narrowing

Every operation with documented error responses has a generated `narrowError_<operation>` wrapper. It narrows the default HTTP `SentryApiError` to the operation's status-to-body type map, preserving its metadata. These wrappers remain standalone functions; pass `sentry.client` to reuse the client configured above:

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
    // Unexpected HTTP status.
    throw result.error;
  }

  switch (result.error.status) {
    case 403:
    case 404:
      throw result.error;
  }
}
```

Checking `documented` first separates the operation's finite HTTP error union from unexpected statuses. Within the documented branch, checking `status` narrows `body` to that response's schema. This is a schema-based type assertion, **not runtime payload validation**. Error bodies remain `unknown` where the source OpenAPI response has no schema. Ordinary operations set `documented: false`; only these opt-in helpers know the operation's status map.

These helpers reclassify base `SentryApiError` instances belonging to the operation's response, including ones returned by an interceptor. Other errors—including custom classes/subclasses, fetch failures, cancellation, and decoding/validation exceptions—reject unchanged. They are not used implicitly by operations or pagination. Consumers that own their error model should use ordinary operations instead.

### Migrating the 0.x response contract

- `responseStyle: "data"` is no longer accepted, including at initialization, `setConfig`, and per call. JavaScript callers receive a `TypeError` before a request is sent. Read `result.data` from the stable fields result instead.
- HTTP errors previously exposed a raw body; now read `error.body` after narrowing to `SentryApiError`. `error.rawBody` retains the original text.
- Successful results omit `error`; failed results include it even when the error value is falsy. Manual result fixtures must follow that shape. Use `"error" in result` rather than a truthiness check.
- Error interceptors receive normalized HTTP errors and chain their returned values. Pagination and `unwrapResult` no longer create another error or prepend a helper-specific message; their legacy `context` argument remains accepted.
- `narrowError_*` and `callWithTypedErrors` now narrow HTTP failures only. Other failures reject unchanged instead of becoming a synthetic transport `SentryApiError`. `SentryApiTransportError` remains a deprecated type alias, but is no longer part of `NarrowedResult`.

## Pagination

Sentry uses cursor-based pagination via `Link` headers. Choose one of three helpers on your configured client:

| Task | Method | Result |
| --- | --- | --- |
| Display one page, with previous/next navigation | `sentry.fetchPage.<operation>(options, cursor?)` | `{ data, response, nextCursor?, prevCursor? }` |
| Collect up to an item limit | `sentry.paginateUpTo.<operation>(options, { limit, ... })` | `{ data, stopReason, nextCursor?, continuation? }` |
| Explicitly collect pages eagerly | `sentry.paginateAll.<operation>(options, { maxPages?, startCursor? }?)` | `{ data, stopReason, nextCursor? }` |

`fetchPage` is available for operations whose schema declares a `cursor` query parameter. Collection helpers are available only when the operation's 200 response is an array. Compound response bodies remain intact. Ordinary operation methods such as `sentry.listOrganizations()` still make just one request.

All helpers reuse the instance's configuration and interceptors and can be destructured. They manage `cursor` separately from `query`, retaining your path, filters, and `signal` while invoking the configured operation. The SDK does not own page history or a response cache: the consumer keeps cursors in its URL, query cache, or persistent storage.

Pagination reads HTTP headers from the same fields contract. Helpers always reject on failure, preserving the exact error: `SentryApiError` for default HTTP failures, or the original custom error/cancellation. This is consistent whether `throwOnError` is enabled or disabled.

Generated collection helpers pass the same signal to every page operation. If it aborts between pages, the next page is not dispatched and the collection rejects; no partial collection is returned.

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

If a server ignores the size or an operation cannot be resized, the helper trims any excess rows and omits the unsafe server `nextCursor`. It reports `stopReason: "limit"`, even if that was the server's last page. The separate `continuation` retains a position before the pending rows.

### Resume a partially consumed page

```ts
const options = {
  path: { organization_id_or_slug: "my-org" },
  query: { per_page: 100 },
};
const batch = await sentry.paginateUpTo.listOrganizationProjects(options, { limit: 250 });
// Requests three pages of 100 and returns 250 rows.
// nextCursor is absent: the next server page would skip the remaining 50.
if (batch.continuation) {
  const next = await sentry.paginateUpTo.listOrganizationProjects(options, {
    limit: 25,
    resume: batch.continuation,
  });
  // Refetches the third page unchanged and returns its next 25 rows.
}
```

`paginateUpTo` returns a `continuation` whenever more rows remain, including on the last server page. Pass it back as `resume`; do not combine it with `startCursor`. At a page boundary it contains the next opaque server `cursor` and `offset: 0`. Within a page it contains the cursor used to fetch that page (absent for the first page), the consumed `offset`, and the original `requestBudget`. It can round-trip through JSON. Keep the same operation, filters, page-size options and fetcher configuration. The SDK does not store credentials, requests or history in it.

For standalone `paginateUpTo(fetcher, options, context)`, the callback's second argument is a request budget. It normally equals the remaining item limit. On a partial replay it repeats the original budget so a custom fetcher reconstructs the same request, even when the new batch limit is smaller. After that page, the callback receives the new remaining budget. A callback must retain its own operation-specific sizing rules; the SDK never derives them from the cursor's contents.

The standalone collector also accepts a callback returning a normalized `{ data: T[], nextCursor? }` page, including the result of `fetchPage`. Such a callback owns response/error handling and rejects on failure; `request` and `error` are reserved for SDK operation envelopes. Its explicit `nextCursor` is authoritative; the collector does not reinterpret an attached `Response`. SDK operation results retain their existing unwrapping and error behavior. The exported `BudgetedPageFetcher` type is unchanged; `CollectionPageFetcher` describes this additional composition path.

```ts
import { paginateUpTo } from "@sentry/api";

const batch = await paginateUpTo(
  cursor => sentry.fetchPage.listOrganizationProjects(options, cursor),
  { limit: 250 },
  "listOrganizationProjects",
);
```

`nextCursor` keeps its existing meaning and can still be sent directly to the API. A `continuation` is SDK state, not a server cursor. Existing single-page, custom-bookmark and infinite-query consumers can continue using ordinary operations or `fetchPage`; neither API changes.

### Consume an already fetched page

For a consumer that owns fetching, `consumePage` shares the row-consumption logic without performing I/O or requiring a `Response`:

```ts
import { consumePage } from "@sentry/api";

const page = await sentry.fetchPage.listOrganizationProjects(options, cursor);
const consumed = consumePage(page, { cursor, offset: 0 }, 25);
// Keep page.response and any consumer metadata separately.
// consumed.position identifies where to continue; absence means exhausted.
```

To resume a position, fetch its cursor with the same page options and pass that position to `consumePage`. A manual `PagePosition` describes row consumption; `paginateUpTo` additionally records the request budget in its `PaginationContinuation`. The caller owns serialization, custom filtering/bookmarks and navigation history. Neither helper snapshots data against concurrent server changes.

### Eager collection and completion

```ts
const projects = await sentry.paginateAll.listOrganizationProjects(
  { path: { organization_id_or_slug: "my-org" } },
  { maxPages: 50 },
);
console.log(projects.data, projects.stopReason);
// If stopReason is "maxPages", projects.nextCursor resumes traversal.
```

Both collection helpers return `PaginatedCollection<TItem>`. Only `paginateUpTo` supplies the additional `continuation` described above:

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

Generic helpers delegate cancellation to your fetcher. Pass its signal through to the operation or transport it invokes; the helper cannot cancel an arbitrary callback.

## Schema source

The OpenAPI schema is synced from [`getsentry/sentry`](https://github.com/getsentry/sentry/tree/master/api-docs). Schema fixes belong there; build/tooling changes belong here.

## License

FSL-1.1-Apache-2.0. See [LICENSE.md](LICENSE.md).
