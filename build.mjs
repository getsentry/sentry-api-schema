import { createClient } from "@hey-api/openapi-ts";
import { build } from "esbuild";
import { cpSync, appendFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normalizeSpec } from "./lib/normalize-spec.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Hey API attaches descriptions only to typed schemas, not to unions, so an
 * OpenAPI 3.0 `nullable` field (a union with `null` in its IR) loses its
 * description. Give the field's one non-null branch the description instead.
 */
function describeNullableValues(ir) {
  const seen = new WeakSet();
  const visit = node => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (node.logicalOperator === "or" && node.description && Array.isArray(node.items)) {
      const values = node.items.filter(item => item.type !== "null");
      if (values.length === 1 && values.length < node.items.length) {
        values[0].description ??= node.description;
      }
    }
    Object.values(node).forEach(visit);
  };
  visit(ir);
}

// `metadata: true` attaches each OpenAPI description to its schema, so
// consumers can read field descriptions at runtime.
// Since 0.95, validators only compose request schemas when another plugin asks
// for them. Keep our public *Data exports without enabling SDK validation.
const validatorOptions = {
  metadata: true,
  requests: { shouldExtract: true },
  "~hooks": {
    events: {
      "plugin:handler:before": ({ plugin }) => describeNullableValues(plugin.context.ir),
      "plugin:handler:after": ({ plugin }) => {
        plugin.forEach("operation", ({ operation }) => {
          plugin.api.createRequestSchema({ operation, plugin });
        });
      },
    },
  },
};

// 0.5 Normalize verbose English sentence operationIds to short REST-conventional
//     identifiers (e.g. "List Your Organizations" → "listOrganizations").
//     Writes a temporary openapi-normalized.json that the generator reads instead
//     of the source spec. The source spec is never modified.
//     OperationIds that are already identifiers (no spaces) are left untouched —
//     those were set intentionally via @extend_schema(operation_id=...).
normalizeSpec("./openapi-derefed.json", "./openapi-normalized.json");

// 1. Generate TypeScript client from OpenAPI spec, including optional
//    Valibot and Zod schemas.
//    When `plugins` is specified, the defaults (TypeScript + SDK + client) are
//    no longer implicit — list them explicitly so the previous output is
//    preserved alongside the validator schemas.
await createClient({
  input: "./openapi-normalized.json",
  output: "src",
  plugins: [
    "@hey-api/typescript",
    "@hey-api/sdk",
    { name: "valibot", ...validatorOptions },
    // Hey API infers Zod 4 output from the `zod` peer range.
    { name: "zod", ...validatorOptions },
  ],
});

// 2. Copy hand-written utilities into the generated src/ directory
cpSync("lib/sentry-pagination.ts", "src/sentry-pagination.ts");
cpSync("lib/sentry-errors.ts", "src/sentry-errors.ts");
cpSync("lib/browser-client.ts", "src/browser-client.ts");
cpSync("lib/source-analysis.ts", "src/source-analysis.ts");
cpSync("lib/api-client", "src/api-client", { recursive: true });

// Keep the pinned Fetch generator's runtime and types aligned with our contract.
execSync(`node ${JSON.stringify(join(__dirname, "scripts", "generate-response-contract.mjs"))}`, { stdio: "inherit" });
execSync(`node ${JSON.stringify(join(__dirname, "scripts", "generate-request-preparation.mjs"))}`, { stdio: "inherit" });
execSync(`node ${JSON.stringify(join(__dirname, "scripts", "generate-base-url-resolver.mjs"))}`, { stdio: "inherit" });

// 3. Generate operation helpers and the bound client from the SDK output.
//    This post-processor inspects src/sdk.gen.ts and openapi-derefed.json,
//    detects every operation that accepts a `cursor` query parameter, and
//    emits typed fetchPage / paginateAll / paginateUpTo wrappers for each.
//    Done as a post-processor (not a Hey API plugin) because the plugin API
//    is documented as in-development and unstable.
execSync(`node ${JSON.stringify(join(__dirname, "scripts", "generate-pagination.mjs"))}`, { stdio: "inherit" });
execSync(`node ${JSON.stringify(join(__dirname, "scripts", "generate-error-results.mjs"))}`, { stdio: "inherit" });
execSync(`node ${JSON.stringify(join(__dirname, "scripts", "generate-query-enum-types.mjs"))}`, { stdio: "inherit" });
execSync(`node ${JSON.stringify(join(__dirname, "scripts", "constrain-throw-options.mjs"))}`, { stdio: "inherit" });
// Client-side query defaults (lib/query-defaults.mjs) go into the operations
// themselves, so bound methods and generated wrappers inherit them.
execSync(`node ${JSON.stringify(join(__dirname, "scripts", "apply-query-defaults.mjs"))}`, { stdio: "inherit" });
execSync(`node ${JSON.stringify(join(__dirname, "scripts", "generate-client.mjs"))}`, { stdio: "inherit" });
execSync(`node ${JSON.stringify(join(__dirname, "scripts", "generate-operations.mjs"))}`, { stdio: "inherit" });
// Use Valibot's description action for the descriptions, which getDescription reads.
execSync(`node ${JSON.stringify(join(__dirname, "scripts", "describe-valibot-schemas.mjs"))}`, { stdio: "inherit" });
// Annotate schema constructors as pure and defer the default client so bundlers
// can drop unused exports and importing the package does no eager work.
execSync(`node ${JSON.stringify(join(__dirname, "scripts", "make-tree-shakeable.mjs"))}`, { stdio: "inherit" });

// 4. Append re-exports to the generated index.ts so the pagination
//    utilities and the per-operation wrappers are part of the public API.
appendFileSync(
  "src/index.ts",
  [
    "",
    "export { callWithTypedErrors, narrowError, SentryApiError } from './sentry-errors.ts';",
    "export type { DocumentedSentryApiError, NarrowedResult, SentryApiResultError, SentryApiTransportError, SdkResult, UndocumentedSentryApiError } from './sentry-errors.ts';",
    "export { parseSentryLinkHeader, unwrapResult, unwrapPaginatedResult, fetchPage, paginateAll, paginateUpTo, consumePage } from './sentry-pagination.ts';",
    "export type { UnwrappedResult, PaginatedResponse, PaginatedCollection, PaginateAllOptions, PaginateUpToOptions, PageFetcher, BudgetedPageFetcher, CollectionPage, CollectionPageFetcher, PagePosition, PaginationContinuation } from './sentry-pagination.ts';",
    "export * from './error-results.gen.ts';",
    "export type * from './query-enums.gen.ts';",
    "export * from './pagination.gen.ts';",
    "export { createSentryClient } from './sentry-client.gen.ts';",
    "export type { SentryClient } from './sentry-client.gen.ts';",
    "export type { BaseUrlRequest, BaseUrlResolver, Config } from './client/index.ts';",
    "",
  ].join("\n"),
);

// 5. Create standalone entry points.
//    valibot/zod: validator-specific schemas with optional peer dependencies.
//    browser: CSRF + cookie auth helpers for browser/frontend use.
//    client, client/endpoints: the shared request layer, whose index files
//    are copied from lib/api-client/ in step 2.
writeFileSync("src/valibot.ts", 'export * from "./valibot.gen.ts";\n');
writeFileSync("src/zod.ts", 'export * from "./zod.gen.ts";\n');
writeFileSync("src/browser.ts", 'export * from "./browser-client.ts";\n');

// 6. Bundle into JS files and emit type declarations.
//    The main entry stays self-contained (zero runtime deps).
//    Validator entries externalise their peers; the root stays dependency-free.
//    Runtime entries target the browser platform, so a Node built-in import
//    fails the build. source-analysis is a Node build tool and keeps node:path.
const bundle = (entry, { external = [], platform = "browser" } = {}) =>
  build({
    entryPoints: [`src/${entry}.ts`],
    outdir: "dist",
    outbase: "src",
    bundle: true,
    format: "esm",
    platform,
    external,
    logLevel: "info",
  });
await Promise.all([
  bundle("index"),
  bundle("valibot", { external: ["valibot"] }),
  bundle("zod", { external: ["zod"] }),
  bundle("browser"),
  // Keep the package entries external so consumers share the root error classes.
  bundle("api-client/index", { external: ["@sentry/api", "http-cache-semantics"] }),
  bundle("api-client/endpoints/index", { external: ["@sentry/api", "@sentry/api/client"] }),
  bundle("operations"),
  bundle("source-analysis", { external: ["typescript"], platform: "node" }),
]);
execSync("tsc --emitDeclarationOnly", { stdio: "inherit" });
