import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json";

const readBundle = (name: string) =>
  Bun.file(new URL(`../dist/${name}.js`, import.meta.url)).text();

describe("package entry points", () => {
  test("keeps validator peers optional", () => {
    expect(packageJson.peerDependencies).toEqual({
      valibot: "*",
      zod: "^3.24.0",
    });
    expect(packageJson.peerDependenciesMeta).toEqual({
      valibot: { optional: true },
      zod: { optional: true },
    });
  });

  test("keeps the root bundle independent from validators", async () => {
    const root = await readBundle("index");
    expect(root).not.toMatch(/from ["']valibot["']/);
    expect(root).not.toMatch(/from ["']zod["']/);
  });

  test("isolates each validator to its own entry point", async () => {
    const [valibot, zod] = await Promise.all([
      readBundle("valibot"),
      readBundle("zod"),
    ]);
    expect(valibot).toMatch(/from ["']valibot["']/);
    expect(valibot).not.toMatch(/from ["']zod["']/);
    expect(zod).toMatch(/from ["']zod["']/);
    expect(zod).not.toMatch(/from ["']valibot["']/);
  });

  test("packs operation metadata and types without client or peer dependencies", () => {
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
      writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({
        compilerOptions: { module: "NodeNext", strict: true, noEmit: true, types: [], lib: ["ES2022"] },
        files: ["types.ts"],
      }));
      execFileSync("node", [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", directory]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
