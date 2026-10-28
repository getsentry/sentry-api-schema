/** Apply lib/query-defaults.mjs to the generated SDK operations in place. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyQueryDefaults, QUERY_DEFAULTS } from "../lib/query-defaults.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sdkPath = join(root, "src", "sdk.gen.ts");
const spec = JSON.parse(readFileSync(join(root, "openapi-derefed.json"), "utf8"));
writeFileSync(sdkPath, applyQueryDefaults(spec, readFileSync(sdkPath, "utf8")));
console.log(`apply-query-defaults: ${QUERY_DEFAULTS.size} operation(s)`);
