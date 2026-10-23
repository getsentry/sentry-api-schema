/**
 * Name the value type of every enum-valued query parameter, e.g.
 * `ListOrganizationTraceItemAttributesQueryDataset` for the `dataset` query
 * parameter of `listOrganizationTraceItemAttributes`. The generator inlines
 * these enums in each operation's `Data` type, so consumers otherwise have to
 * dig them out with `NonNullable<…['query']>['dataset']`.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const normalizedSpec = join(root, "openapi-normalized.json");
const specPath = existsSync(normalizedSpec)
  ? normalizedSpec
  : join(root, "openapi-derefed.json");
const spec = JSON.parse(readFileSync(specPath, "utf8"));

const parse = (name) => {
  const path = join(root, "src", name);
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
};
const sdk = parse("sdk.gen.ts");
const types = parse("types.gen.ts");

/** Top-level type declarations in types.gen.ts, by name. */
const typeDeclarations = new Map();
for (const statement of types.statements) {
  if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
    typeDeclarations.set(statement.name.text, statement);
  }
}

const propertyName = (member, source) =>
  ts.isStringLiteral(member.name) ? member.name.text : member.name.getText(source);

/** Property names of `<Operation>Data['query']`. */
const queryProperties = (dataType) => {
  const declaration = typeDeclarations.get(dataType);
  const literal = declaration && ts.isTypeAliasDeclaration(declaration) && declaration.type;
  if (!literal || !ts.isTypeLiteralNode(literal)) return new Set();
  const query = literal.members.find((member) =>
    ts.isPropertySignature(member) && propertyName(member, types) === "query");
  if (!query?.type || !ts.isTypeLiteralNode(query.type)) return new Set();
  return new Set(
    query.type.members
      .filter((member) => ts.isPropertySignature(member))
      .map((member) => propertyName(member, types)),
  );
};

/**
 * The `Options<…>` reference in an operation's parameter type. It is the type
 * itself for `(options: Options<…>)`, or nested in a tuple for operations whose
 * options are optional: `(...[options]: [options?: Options<…>] & …)`.
 */
const findOptions = (node) => {
  if (ts.isTypeReferenceNode(node) && node.typeName.getText(sdk) === "Options") return node;
  return ts.forEachChild(node, findOptions);
};

/**
 * Each SDK operation's name, `<Operation>Data` type, HTTP method and URL, read
 * from `export const op = (options: Options<OpData, …>) => (…).get<…>({ url: '…', … })`.
 */
const operations = [];
for (const statement of sdk.statements) {
  if (!ts.isVariableStatement(statement)) continue;
  for (const declaration of statement.declarationList.declarations) {
    const fn = declaration.initializer;
    if (!ts.isIdentifier(declaration.name) || !fn || !ts.isArrowFunction(fn)) continue;

    const optionsType = fn.parameters[0]?.type && findOptions(fn.parameters[0].type);
    const dataType = optionsType?.typeArguments?.[0];
    const call = ts.isCallExpression(fn.body) && fn.body;
    const callee = call && call.expression;
    const request = call && call.arguments[0];
    const url = request && ts.isObjectLiteralExpression(request) && request.properties.find((property) =>
      ts.isPropertyAssignment(property) && propertyName(property, sdk) === "url");
    if (
      !dataType || !ts.isTypeReferenceNode(dataType) || !ts.isIdentifier(dataType.typeName) ||
      !callee || !ts.isPropertyAccessExpression(callee) ||
      !url || !ts.isStringLiteralLike(url.initializer)
    ) {
      throw new Error(`generate-query-enum-types: unsupported SDK operation ${declaration.name.text}`);
    }
    operations.push({
      fn: declaration.name.text,
      dataType: dataType.typeName.text,
      route: `${callee.name.text.toUpperCase()} ${url.initializer.text}`,
    });
  }
}

/** `attributeType`, `data_source`, `stats-period` → `AttributeType`, `DataSource`, `StatsPeriod` */
const pascal = (name) =>
  name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");

/** Enum query parameters per route, with whether the parameter is an array. */
const enumParams = new Map();
for (const [path, methods] of Object.entries(spec.paths ?? {})) {
  for (const [method, operation] of Object.entries(methods)) {
    if (typeof operation !== "object" || operation === null) continue;
    const params = [];
    for (const param of operation.parameters ?? []) {
      if (param.in !== "query") continue;
      const schema = param.schema ?? {};
      if (Array.isArray(schema.enum)) {
        params.push({ name: param.name, array: false });
      } else if (schema.type === "array" && Array.isArray(schema.items?.enum)) {
        params.push({ name: param.name, array: true });
      }
    }
    if (params.length > 0) {
      enumParams.set(`${method.toUpperCase()} ${path}`, params);
    }
  }
}

const aliases = [];
const seen = new Set();
for (const { fn, dataType, route } of operations) {
  const params = enumParams.get(route);
  if (!params) continue;

  const typeBase = dataType.replace(/Data$/, "");
  const available = queryProperties(dataType);
  for (const { name, array } of params) {
    if (!available.has(name)) {
      throw new Error(`generate-query-enum-types: ${dataType}['query'] has no ${name} property`);
    }
    const alias = `${typeBase}Query${pascal(name)}`;
    if (typeDeclarations.has(alias) || seen.has(alias)) {
      throw new Error(`generate-query-enum-types: ${alias} is already defined`);
    }
    seen.add(alias);
    aliases.push({ alias, array, fn, name, typeBase });
  }
}
aliases.sort((a, b) => a.alias.localeCompare(b.alias));

const typeBases = [...new Set(aliases.map(({ typeBase }) => `${typeBase}Data`))].sort();
const lines = [
  "// This file is auto-generated by scripts/generate-query-enum-types.mjs",
  "// Do not edit directly. Re-run `bun run build` to regenerate.",
  "",
  "import type {",
  ...typeBases.map((typeName) => `    ${typeName},`),
  "} from './types.gen';",
  "",
];
for (const { alias, array, fn, name, typeBase } of aliases) {
  const value = `NonNullable<NonNullable<${typeBase}Data['query']>[${JSON.stringify(name)}]>`;
  lines.push(
    `/** A value of the \`${name}\` query parameter of \`${fn}\`. */`,
    `export type ${alias} = ${array ? `${value}[number]` : value};`,
    "",
  );
}

writeFileSync(join(root, "src", "query-enums.gen.ts"), lines.join("\n"));
console.log(`generate-query-enum-types: ${aliases.length} query enum types`);
