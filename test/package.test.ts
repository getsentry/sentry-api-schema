import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json";

const readBundle = (name: string) =>
  Bun.file(new URL(`../dist/${name}.js`, import.meta.url)).text();

describe("package entry points", () => {
  test("keeps validator and source-analysis peers optional", () => {
    expect(packageJson.peerDependencies).toEqual({
      typescript: "*",
      valibot: "*",
      zod: "^3.24.0",
    });
    expect(packageJson.peerDependenciesMeta).toEqual({
      typescript: { optional: true },
      valibot: { optional: true },
      zod: { optional: true },
    });
  });

  test("keeps the root bundle independent from optional tools and validators", async () => {
    const root = await readBundle("index");
    expect(root).not.toMatch(/from ["']typescript["']/);
    expect(root).not.toMatch(/from ["']valibot["']/);
    expect(root).not.toMatch(/from ["']zod["']/);
  });

  test("isolates optional tools and validators to their own entry points", async () => {
    const [valibot, zod, analysis] = await Promise.all([
      readBundle("valibot"),
      readBundle("zod"),
      readBundle("source-analysis"),
    ]);
    expect(valibot).toMatch(/from ["']valibot["']/);
    expect(valibot).not.toMatch(/from ["']zod["']/);
    expect(zod).toMatch(/from ["']zod["']/);
    expect(zod).not.toMatch(/from ["']valibot["']/);
    expect(analysis).toMatch(/from ["']typescript["']/);
    expect(analysis).not.toMatch(/from ["'](?:valibot|zod)["']/);
  });

  test("packs isolated runtime entries and build-time analysis with NodeNext types", () => {
    const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
    const directory = mkdtempSync(join(tmpdir(), "api-package-"));
    try {
      const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", directory], {
        cwd: root,
        encoding: "utf8",
      })) as { filename: string }[];
      const installed = join(directory, "node_modules", "@sentry", "api");
      mkdirSync(installed, { recursive: true });
      execFileSync("tar", ["-xzf", join(directory, packed[0]!.filename), "-C", installed, "--strip-components=1"]);
      writeFileSync(join(directory, "package.json"), JSON.stringify({ type: "module" }));
      writeFileSync(join(directory, "client.mjs"), `
        import assert from "node:assert/strict";
        const client = await import("@sentry/api");
        const browser = await import("@sentry/api/browser");
        assert.equal(typeof client.createSentryClient, "function");
        assert.equal(typeof browser.createBrowserFetch, "function");
        assert.equal("analyzeSourceApiUsage" in client, false);
      `);
      execFileSync("node", ["client.mjs"], { cwd: directory });
      writeFileSync(join(directory, "smoke.mjs"), `
        import assert from "node:assert/strict";
        for (const name of ["fetch", "Request", "Headers"]) {
          Object.defineProperty(globalThis, name, { get() { throw new Error("Accessed transport global: " + name); } });
        }
        const { operations } = await import("@sentry/api/operations");
        assert(operations.some(operation => operation.functionName === "listOrganizations"));
      `);
      execFileSync("node", ["smoke.mjs"], { cwd: directory });

      writeFileSync(join(directory, "types.ts"), readFileSync(new URL("./operation-types.ts", import.meta.url)));
      writeFileSync(join(directory, "analysis-types.ts"), readFileSync(new URL("./source-analysis-types.ts", import.meta.url)));
      writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({
        compilerOptions: { module: "NodeNext", strict: true, noEmit: true, types: [], lib: ["ES2022"] },
        files: ["types.ts", "analysis-types.ts"],
      }));
      execFileSync("node", [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", directory]);

      symlinkSync(join(root, "node_modules", "typescript"), join(directory, "node_modules", "typescript"), "dir");
      writeFileSync(join(directory, "analysis.mjs"), `
        import assert from "node:assert/strict";
        import { operations } from "@sentry/api/operations";
        import { analyzeSourceApiUsage } from "@sentry/api/source-analysis";
        const source = 'import { listOrganizationEvents } from "@sentry/api"; export const readLogs = () => listOrganizationEvents({ query: { dataset: "logs" } });';
        const result = analyzeSourceApiUsage(new Map([["feature.ts", source]]), operations, {
          queryParameters: ["dataset"],
        });
        const usage = result.exports.get("feature.ts").get("readLogs");
        assert.equal(usage.operations[0].functionName, "listOrganizationEvents");
        assert.deepEqual(usage.operations[0].query, { dataset: "logs" });
        assert.deepEqual(usage.methods, ["GET"]);
        assert.deepEqual(usage.unresolvedRequests, []);
      `);
      execFileSync("node", ["analysis.mjs"], { cwd: directory });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
