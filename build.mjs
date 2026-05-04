import { createClient } from "@hey-api/openapi-ts";
import { cpSync, appendFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 1. Generate TypeScript client from OpenAPI spec
await createClient({
  input: "./openapi-derefed.json",
  output: "src",
});

// 2. Copy hand-written pagination utilities into the generated src/ directory
cpSync("lib/sentry-pagination.ts", "src/sentry-pagination.ts");

// 3. Generate per-operation pagination wrappers from the SDK output + spec.
//    This post-processor inspects src/sdk.gen.ts and openapi-derefed.json,
//    detects every operation that accepts a `cursor` query parameter, and
//    emits typed fetchPage / paginateAll / paginateUpTo wrappers for each.
//    Done as a post-processor (not a Hey API plugin) because the plugin API
//    is documented as in-development and unstable.
execSync(`node ${JSON.stringify(join(__dirname, "scripts", "generate-pagination.mjs"))}`, { stdio: "inherit" });

// 4. Append re-exports to the generated index.ts so the pagination
//    utilities and the per-operation wrappers are part of the public API.
appendFileSync(
  "src/index.ts",
  [
    "",
    "export { parseSentryLinkHeader, unwrapResult, unwrapPaginatedResult, fetchPage, paginateAll, paginateUpTo } from './sentry-pagination.ts';",
    "export type { UnwrappedResult, PaginatedResponse, PaginateAllOptions, PaginateUpToOptions, PageFetcher } from './sentry-pagination.ts';",
    "export * from './pagination.gen.ts';",
    "",
  ].join("\n"),
);

// 5. Bundle into a single JS file and emit type declarations
execSync("bun build src/index.ts --outdir dist", { stdio: "inherit" });
execSync("tsc --emitDeclarationOnly", { stdio: "inherit" });
