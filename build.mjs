import { createClient } from "@hey-api/openapi-ts";
import { cpSync, appendFileSync } from "node:fs";
import { execSync } from "node:child_process";

// 1. Generate TypeScript client from OpenAPI spec
await createClient({
  input: "./openapi-derefed.json",
  output: "src",
});

// 2. Copy hand-written pagination utilities into the generated src/ directory
cpSync("lib/sentry-pagination.ts", "src/sentry-pagination.ts");

// 3. Append re-exports to the generated index.ts so pagination is part of the public API
appendFileSync(
  "src/index.ts",
  [
    "",
    "export { parseSentryLinkHeader, unwrapResult, unwrapPaginatedResult, paginateAll } from './sentry-pagination.ts';",
    "export type { UnwrappedResult, PaginatedResponse, PaginateAllOptions, PageFetcher } from './sentry-pagination.ts';",
    "",
  ].join("\n"),
);

// 4. Bundle into a single JS file and emit type declarations
execSync("bun build src/index.ts --outdir dist", { stdio: "inherit" });
execSync("tsc --emitDeclarationOnly", { stdio: "inherit" });
