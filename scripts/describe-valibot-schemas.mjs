/**
 * Turn the OpenAPI descriptions that the Valibot plugin attaches as
 * `v.metadata({ description })` into Valibot's own `v.description(…)` action.
 *
 * - `v.getDescription()` and other Valibot tooling read the `description`
 *   action, not a `description` key inside `v.metadata`.
 * - Top-level schemas keep no description pipe, so their types stay as they
 *   were: `v.pick`, `v.omit`, `v.partial` and `v.required` reject piped object
 *   schemas. Their description is already in their JSDoc comment, and for
 *   responses it is often only the status text, such as "No Content".
 *
 * Runs before make-tree-shakeable.mjs, on the plain generator output. Fails
 * closed if the generator emits a metadata shape this script does not handle.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const path = fileURLToPath(new URL("../src/valibot.gen.ts", import.meta.url));

/** The `v.<name>` a call expression invokes, if any. */
function valibotCall(node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
  const { expression, name } = node.expression;
  return ts.isIdentifier(expression) && expression.text === "v" ? name.text : undefined;
}

/** Apply `[start, end, text]` edits, which must not overlap. */
function applyEdits(source, edits) {
  let output = source;
  for (const [start, end, text] of edits.sort((a, b) => b[0] - a[0])) {
    output = output.slice(0, start) + text + output.slice(end);
  }
  return output;
}

function unpipeTopLevelSchemas(source) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const edits = [];
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const { initializer: pipe } of statement.declarationList.declarations) {
      if (!pipe || valibotCall(pipe) !== "pipe") continue;
      const args = pipe.arguments;
      if (valibotCall(args.at(-1)) !== "metadata") continue;
      if (args.length === 2) {
        edits.push([pipe.getStart(file), args[0].getStart(file), ""], [args[0].end, pipe.end, ""]);
      } else {
        edits.push([args.at(-2).end, args.at(-1).end, ""]);
      }
    }
  }
  return applyEdits(source, edits);
}

function metadataToDescription(source) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const edits = [];
  const visit = node => {
    if (valibotCall(node) === "metadata") {
      const [metadata] = node.arguments;
      const properties = metadata && ts.isObjectLiteralExpression(metadata) ? metadata.properties : [];
      const [property] = properties;
      if (
        node.arguments.length !== 1 || properties.length !== 1
        || !ts.isPropertyAssignment(property) || property.name.getText(file) !== "description"
      ) {
        throw new Error(`valibot.gen.ts: unexpected metadata shape: ${node.getText(file).slice(0, 80)}`);
      }
      edits.push([node.getStart(file), node.end, `v.description(${property.initializer.getText(file)})`]);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (edits.length === 0) {
    throw new Error("valibot.gen.ts: found no `v.metadata` descriptions; is the Valibot `metadata` option on?");
  }
  return applyEdits(source, edits);
}

writeFileSync(path, metadataToDescription(unpipeTopLevelSchemas(readFileSync(path, "utf8"))));
