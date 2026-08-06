import { describe, expect, test } from "bun:test";
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
});
