/**
 * Keep the generated modules free of eager work at import time so bundlers can
 * drop whatever a consumer does not use.
 *
 * - Validator schemas: every top-level `v.*(…)` / `z.*(…)` call gets a
 *   `/* @__PURE__ *\/` annotation. Nested calls need their own annotation:
 *   bundlers keep the side effects of a removed pure call's arguments. One
 *   annotation covers a whole method chain (`z.number().int().optional()`),
 *   because every call in the chain starts at the same position.
 * - Default client: created on first use, so importing the SDK does not
 *   construct `Headers` (which makes Node load its fetch implementation).
 *
 * Each step fails closed so generator upgrades cannot silently undo it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const PURE = "/* @__PURE__ */ ";

function update(name, transform) {
  const path = fileURLToPath(new URL(`../src/${name}`, import.meta.url));
  writeFileSync(path, transform(readFileSync(path, "utf8"), name));
}

function rootIdentifier(expression) {
  while (
    ts.isCallExpression(expression)
    || ts.isPropertyAccessExpression(expression)
    || ts.isElementAccessExpression(expression)
    || ts.isParenthesizedExpression(expression)
  ) {
    expression = expression.expression;
  }
  return ts.isIdentifier(expression) ? expression.text : undefined;
}

function isBigIntLiteralCall(node) {
  return ts.isIdentifier(node.expression)
    && node.expression.text === "BigInt"
    && node.arguments.length === 1
    && (ts.isNumericLiteral(node.arguments[0]) || ts.isStringLiteral(node.arguments[0]));
}

function annotateSchemaCalls(namespace) {
  return (source, name) => {
    const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
    const positions = new Set();

    const visit = node => {
      // Calls inside callbacks do not run at import time; leave them alone.
      if (ts.isFunctionLike(node)) return;
      if (ts.isNewExpression(node)) {
        throw new Error(`${name}: unexpected top-level \`new\` expression: ${node.getText(file).slice(0, 80)}`);
      }
      if (ts.isCallExpression(node)) {
        // `BigInt(<literal>)` bounds on int64 schemas are pure and need no annotation.
        if (isBigIntLiteralCall(node)) return;
        if (rootIdentifier(node.expression) !== namespace) {
          throw new Error(`${name}: unexpected top-level call outside \`${namespace}.*\`: ${node.getText(file).slice(0, 80)}`);
        }
        positions.add(node.getStart(file));
      }
      ts.forEachChild(node, visit);
    };

    for (const statement of file.statements) {
      if (ts.isImportDeclaration(statement)) continue;
      if (!ts.isVariableStatement(statement)) {
        throw new Error(`${name}: unexpected top-level statement: ${statement.getText(file).slice(0, 80)}`);
      }
      visit(statement);
    }
    if (positions.size === 0) {
      throw new Error(`${name}: found no \`${namespace}.*\` schema calls to annotate`);
    }

    let output = "";
    let last = 0;
    for (const position of [...positions].sort((a, b) => a - b)) {
      output += source.slice(last, position) + PURE;
      last = position;
    }
    return output + source.slice(last);
  };
}

update("valibot.gen.ts", annotateSchemaCalls("v"));
update("zod.gen.ts", annotateSchemaCalls("z"));

update("client.gen.ts", source => {
  const replacements = [
    [
      "import { type ClientOptions, type Config, createClient, createConfig } from './client';",
      "import { type ClientOptions, type Config, createClient, createConfig, type PreparedClient } from './client';",
    ],
    [
      "export const client = createClient(createConfig<ClientOptions2>());",
      `let defaultClient: PreparedClient | undefined;

/**
 * The default client used when an operation is called without \`client\`.
 * It is created on first use so importing the SDK stays free of eager work.
 */
export const client: PreparedClient = ${PURE}new Proxy({} as PreparedClient, {
  get: (_target, key) => Reflect.get((defaultClient ??= createClient(createConfig<ClientOptions2>())), key),
});`,
    ],
  ];
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) {
      throw new Error(`client.gen.ts changed: expected one match: ${before}`);
    }
    source = source.replace(before, () => after);
  }
  return source;
});
