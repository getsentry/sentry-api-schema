import { createClient } from "@hey-api/openapi-ts";
import { cpSync, appendFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normalizeSpec } from "./lib/normalize-spec.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 0.5 Normalize verbose English sentence operationIds to short REST-conventional
//     identifiers (e.g. "List Your Organizations" → "listOrganizations").
//     Writes a temporary openapi-normalized.json that the generator reads instead
//     of the source spec. The source spec is never modified.
//     OperationIds that are already identifiers (no spaces) are left untouched —
//     those were set intentionally via @extend_schema(operation_id=...).
normalizeSpec("./openapi-derefed.json", "./openapi-normalized.json");

// 1. Generate TypeScript client from OpenAPI spec (including Zod schemas).
//    When `plugins` is specified, the defaults (TypeScript + SDK + client) are
//    no longer implicit — list them explicitly so the previous output is
//    preserved alongside the new Zod schemas.
await createClient({
  input: "./openapi-normalized.json",
  output: "src",
  plugins: [
    "@hey-api/typescript",
    "@hey-api/sdk",
    {
      name: "zod",
      compatibilityVersion: 3,
    },
  ],
});

// 2. Copy hand-written utilities into the generated src/ directory
cpSync("lib/sentry-pagination.ts", "src/sentry-pagination.ts");
cpSync("lib/browser-client.ts", "src/browser-client.ts");
cpSync("lib/auth-config.ts", "src/auth-config.ts");

// 3. Generate per-operation pagination wrappers from the SDK output + spec.
//    This post-processor inspects src/sdk.gen.ts and openapi-derefed.json,
//    detects every operation that accepts a `cursor` query parameter, and
//    emits typed fetchPage / paginateAll / paginateUpTo wrappers for each.
//    Done as a post-processor (not a Hey API plugin) because the plugin API
//    is documented as in-development and unstable.
execSync(`node ${JSON.stringify(join(__dirname, "scripts", "generate-pagination.mjs"))}`, { stdio: "inherit" });

// 4. Append re-exports to the generated index.ts so the pagination utilities,
//    the per-operation wrappers, the auth factories, and the client itself are
//    all part of the public API surface.
appendFileSync(
  "src/index.ts",
  [
    "",
    "export { parseSentryLinkHeader, unwrapResult, unwrapPaginatedResult, fetchPage, paginateAll, paginateUpTo } from './sentry-pagination.ts';",
    "export type { UnwrappedResult, PaginatedResponse, PaginateAllOptions, PaginateUpToOptions, PageFetcher, SdkResult } from './sentry-pagination.ts';",
    "export * from './pagination.gen.ts';",
    // Auth/config factories (see lib/auth-config.ts). browserSession lives in ./browser.
    "export { bearerToken, DEFAULT_BASE_URL } from './auth-config.ts';",
    "export type { BearerTokenOptions, SentryApiConfig, FetchFn } from './auth-config.ts';",
    // The client itself: the global singleton (client.setConfig) plus factories
    // for isolated instances (createSentryClient is createClient, Sentry-branded).
    "export { client } from './client.gen.ts';",
    "export { createClient, createClient as createSentryClient, createConfig } from './client/index.ts';",
    // Config only: `ClientOptions` is already re-exported from types.gen above.
    "export type { Config } from './client/index.ts';",
    "",
  ].join("\n"),
);

// 5. Create standalone entry points.
//    zod: lets consumers import from "@sentry/api/zod" without pulling zod into
//    code that only needs the SDK types and functions.
//    browser: CSRF + cookie auth helpers for browser/frontend use.
writeFileSync("src/zod.ts", 'export * from "./zod.gen.ts";\n');
writeFileSync("src/browser.ts", 'export * from "./browser-client.ts";\n');

// 6. Bundle into JS files and emit type declarations.
//    The main entry stays self-contained (zero runtime deps).
//    The Zod entry externalises "zod" — consumers provide it themselves.
execSync("bun build src/index.ts --outdir dist", { stdio: "inherit" });
execSync('bun build src/zod.ts --outdir dist --external zod', { stdio: "inherit" });
execSync("bun build src/browser.ts --outdir dist", { stdio: "inherit" });
execSync("tsc --emitDeclarationOnly", { stdio: "inherit" });
