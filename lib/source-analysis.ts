/** Build-time analysis of API usage in consumer-supplied TypeScript source. */

import { dirname, posix } from "node:path";
import ts from "typescript";
import type { ApiOperation } from "./operation-types.js";

/** Identity supplied by the generated SDK operation catalog. */
export type SourceApiOperation = Pick<ApiOperation, "functionName" | "method" | "path">;

/** A consumer's raw request wrapper, identified by its resolved function name. */
export type SourceApiRequest = {
  functionName: string;
  /** Zero-based argument containing the request path. */
  pathArgument: number;
  /** Zero-based argument containing the options object. */
  optionsArgument: number;
  /** Options property containing query parameters. Defaults to `query`. */
  queryProperty?: string;
  /** Method when the options omit it. Defaults to GET; unknown spreads stay unknown. */
  defaultMethod?: string;
};

/** Consumer conventions; none of these lists are inferred from command names. */
export type SourceApiAnalysisOptions = {
  /** Factory names whose returned objects contain deferred callbacks. */
  boundaries?: readonly string[];
  /** Raw request wrappers to link to the operation catalog. */
  requests?: readonly SourceApiRequest[];
  /** Query keys to retain. The Sentry `query` key also retains fixed joined terms. */
  queryParameters?: readonly string[];
  /** Boolean property names to report when explicitly set to true. */
  declarationFlags?: readonly string[];
};

/** An operation reachable from a source declaration. */
export type SourceOperationUsage = SourceApiOperation & {
  /** Known query values or fixed terms; callers may add further filters. */
  query?: Record<string, string>;
};

/** A raw request whose identity cannot be established from the public catalog. */
export type UnresolvedApiRequest = {
  /** Source module, using the caller's source-map keys. */
  file: string;
  /** One-based request call line. */
  line: number;
  /** Known HTTP method, when statically available. */
  method?: string;
  /** Known path template, when statically available. */
  path?: string;
  /** Why no operation was selected. */
  reason: string;
};

/** Source-derived relationships; no command is executed to obtain them. */
export type SourceApiUsage = {
  /** All statically reachable API operations, preserving distinct contexts. */
  operations: SourceOperationUsage[];
  /** Reachable raw requests that need explicit discovery diagnostics. */
  unresolvedRequests: UnresolvedApiRequest[];
  /** Known HTTP methods, including unresolved requests and static method properties. */
  methods: string[];
};

/** Source relationships and deferred callback boundaries; never executes input code. */
export type SourceApiAnalysis = {
  /** Source file → exported symbol → reachable API usage. */
  exports: Map<string, Map<string, SourceApiUsage>>;
  /** Exported boundaries and their consumer-selected factory/flag evidence. */
  boundaries: { file: string; name: string; factories: string[]; flags: string[] }[];
};

type Binding = { file: string; name: string };
type Declaration = {
  node: ts.Node;
  refs: Set<string>;
  calls: Set<string>;
  usage: SourceApiUsage;
  boundary: boolean;
  factories: Set<string>;
  flags: Set<string>;
};
type Module = {
  source: ts.SourceFile;
  imports: Map<string, Binding>;
  exports: Map<string, Binding>;
  stars: string[];
  declarations: Map<string, Declaration>;
};

const SDK = "@sentry/api";
const API_PREFIX = /^\/api\/\d+(?=\/)/;
const PATH_PARAMETER = /\{[^}]*\}/g;

function unwrap(node: ts.Node): ts.Node {
  return ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isNonNullExpression(node)
    ? unwrap(node.expression)
    : node;
}

function sourceModule(
  file: string,
  specifier: string,
  sources: ReadonlyMap<string, string>,
): string {
  if (!specifier.startsWith(".")) return specifier;
  const target = posix.normalize(
    posix.join(dirname(file), specifier.replace(/\.js$/, ".ts")),
  );
  return !sources.has(target) && sources.has(`${target}x`)
    ? `${target}x`
    : target;
}

function parseModule(
  file: string,
  text: string,
  sources: ReadonlyMap<string, string>,
): Module {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const mod: Module = {
    source,
    imports: new Map(),
    exports: new Map(),
    stars: [],
    declarations: new Map(),
  };
  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      if (statement.importClause?.isTypeOnly) continue;
      const target = sourceModule(
        file,
        statement.moduleSpecifier.text,
        sources,
      );
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const binding of bindings.elements) {
          if (!binding.isTypeOnly)
            mod.imports.set(binding.name.text, {
              file: target,
              name: (binding.propertyName ?? binding.name).text,
            });
        }
      } else if (bindings && ts.isNamespaceImport(bindings)) {
        mod.imports.set(bindings.name.text, { file: target, name: "*" });
      }
      continue;
    }
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      const target =
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)
          ? sourceModule(file, statement.moduleSpecifier.text, sources)
          : file;
      if (!statement.exportClause) mod.stars.push(target);
      else if (ts.isNamedExports(statement.exportClause)) {
        for (const binding of statement.exportClause.elements) {
          if (!binding.isTypeOnly)
            mod.exports.set(binding.name.text, {
              file: target,
              name: (binding.propertyName ?? binding.name).text,
            });
        }
      }
      continue;
    }
    const nodes: [string, ts.Node][] = [];
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body)
      nodes.push([statement.name.text, statement]);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer)
          nodes.push([declaration.name.text, declaration.initializer]);
      }
    }
    for (const [name, node] of nodes) {
      mod.declarations.set(name, {
        node,
        refs: new Set(),
        calls: new Set(),
        usage: { operations: [], unresolvedRequests: [], methods: [] },
        boundary: false,
        factories: new Set(),
        flags: new Set(),
      });
      if (
        ts.canHaveModifiers(statement) &&
        ts
          .getModifiers(statement)
          ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      )
        mod.exports.set(name, { file, name });
    }
  }
  return mod;
}

/**
 * Follow function references, imports and barrel exports to SDK calls or known
 * raw request wrappers. Dynamic paths remain diagnostics rather than guesses.
 * Boundary factories have their arguments inspected, without traversing the
 * factory's execution machinery. Reading their returned objects as data does
 * not inherit callback usage. Results describe static reachability, not a
 * complete execution trace; dynamic behavior may not be discoverable.
 */
export function analyzeSourceApiUsage(
  sources: ReadonlyMap<string, string>,
  operations: readonly SourceApiOperation[],
  options: SourceApiAnalysisOptions = {},
): SourceApiAnalysis {
  const boundaries = new Set(options.boundaries);
  const requests = new Map(options.requests?.map(request => [request.functionName, request]));
  const declarationFlags = new Set(options.declarationFlags);
  const modules = new Map(
    [...sources].map(([file, text]) => [
      file,
      parseModule(file, text, sources),
    ]),
  );
  const sdk = new Map(
    operations.map((operation) => [operation.functionName, operation]),
  );
  const identities = new Map<string, SourceApiOperation[]>();
  const pathKey = (path: string) =>
    `/${path.replace(API_PREFIX, "").split("/").filter(Boolean).join("/")}/`.replace(
      PATH_PARAMETER,
      "{}",
    );
  for (const operation of operations) {
    const key = `${operation.method}:${pathKey(operation.path)}`;
    identities.set(key, [...(identities.get(key) ?? []), operation]);
  }

  function resolve(
    binding: Binding,
    seen = new Set<string>(),
  ): Binding | undefined {
    if (binding.file === SDK) return binding;
    const key = `${binding.file}#${binding.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    const mod = modules.get(binding.file);
    if (!mod) return;
    if (mod.declarations.has(binding.name)) return binding;
    const next = mod.exports.get(binding.name) ?? mod.imports.get(binding.name);
    if (next) return resolve(next, seen);
    for (const target of mod.stars) {
      const found = resolve({ file: target, name: binding.name }, seen);
      if (found) return found;
    }
    return;
  }

  function bindingFor(file: string, node: ts.Node): Binding | undefined {
    const mod = modules.get(file)!;
    if (ts.isIdentifier(node)) {
      for (
        let parent = node.parent;
        parent && !ts.isSourceFile(parent);
        parent = parent.parent
      ) {
        if (
          ts.isFunctionLike(parent) &&
          parent.parameters.some(
            (parameter) => parameter.name.getText() === node.text,
          )
        )
          return;
        if (
          ts.isBlock(parent) &&
          parent.statements.some(
            (statement) =>
              ts.isVariableStatement(statement) &&
              statement.declarationList.declarations.some(
                (declaration) => declaration.name.getText() === node.text,
              ),
          )
        )
          return;
      }
      const imported = mod.imports.get(node.text);
      return resolve(imported ?? { file, name: node.text }) ?? imported;
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression)
    ) {
      const namespace = mod.imports.get(node.expression.text);
      if (namespace?.name === "*")
        return resolve({ file: namespace.file, name: node.name.text });
    }
    return;
  }

  function initializer(file: string, node: ts.Node): ts.Node | undefined {
    if (!ts.isIdentifier(node)) return;
    // Only lexical declarations and module constants are evaluated; function
    // parameters stay unknown even if they shadow an imported operation.
    for (
      let parent: ts.Node | undefined = node.parent;
      parent;
      parent = parent.parent
    ) {
      if (
        ts.isFunctionLike(parent) &&
        parent.parameters.some((p) => p.name.getText() === node.text)
      )
        return;
      if (ts.isBlock(parent) || ts.isSourceFile(parent)) {
        for (const statement of parent.statements) {
          if (!ts.isVariableStatement(statement)) continue;
          for (const declaration of statement.declarationList.declarations) {
            if (
              ts.isIdentifier(declaration.name) &&
              declaration.name.text === node.text
            )
              return declaration.initializer;
          }
        }
      }
    }
    const binding = bindingFor(file, node);
    return binding?.file === file
      ? modules.get(file)?.declarations.get(binding.name)?.node
      : undefined;
  }

  function value(
    file: string,
    node: ts.Node | null | undefined,
    template = false,
    seen = new Set<ts.Node>(),
  ): string | undefined {
    if (!node || seen.has(node)) return;
    seen.add(node);
    node = unwrap(node);
    if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node))
      return node.text;
    if (node.kind === ts.SyntaxKind.TrueKeyword) return "true";
    if (node.kind === ts.SyntaxKind.FalseKeyword) return "false";
    if (ts.isIdentifier(node))
      return value(file, initializer(file, node), template, seen);
    if (ts.isTemplateExpression(node)) {
      let result = node.head.text;
      for (const span of node.templateSpans) {
        const part = value(file, span.expression, false, new Set(seen));
        if (part === undefined && !template) return;
        result += (part ?? "{}") + span.literal.text;
      }
      return result;
    }
    return;
  }

  /** Undefined means absent; null means an unknown object/spread can supply it. */
  function property(
    file: string,
    node: ts.Node | null | undefined,
    name: string,
    seen = new Set<ts.Node>(),
  ): ts.Node | null | undefined {
    if (!node || seen.has(node)) return;
    seen.add(node);
    node = unwrap(node);
    if (ts.isIdentifier(node)) {
      const initial = initializer(file, node);
      return initial ? property(file, initial, name, seen) : null;
    }
    if (!ts.isObjectLiteralExpression(node)) return null;
    for (const member of [...node.properties].reverse()) {
      if (
        ts.isPropertyAssignment(member) &&
        member.name.getText().replace(/["']/g, "") === name
      )
        return member.initializer;
      if (ts.isShorthandPropertyAssignment(member) && member.name.text === name)
        return initializer(file, member.name);
      if (ts.isSpreadAssignment(member)) {
        const found = property(file, member.expression, name, seen);
        if (found !== undefined) return found;
      }
    }
    return;
  }

  function queryTerms(
    file: string,
    node: ts.Node | null | undefined,
    seen = new Set<ts.Node>(),
  ): string | undefined {
    if (!node || seen.has(node)) return;
    const exact = value(file, node);
    if (exact !== undefined) return exact;
    seen.add(node);
    node = unwrap(node);
    if (ts.isIdentifier(node))
      return queryTerms(file, initializer(file, node), seen);
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken
    )
      return queryTerms(file, node.left, seen);
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      node.expression.name.text !== "join" ||
      value(file, node.arguments[0]) !== " "
    )
      return;
    let array: ts.Node = node.expression.expression;
    if (
      ts.isCallExpression(array) &&
      ts.isPropertyAccessExpression(array.expression) &&
      array.expression.name.text === "filter" &&
      array.arguments[0]?.getText() === "Boolean"
    )
      array = array.expression.expression;
    if (!ts.isArrayLiteralExpression(array)) return;
    const terms = array.elements
      .map((item) => value(file, item))
      .filter((term): term is string => !!term);
    return terms.length ? terms.join(" ") : undefined;
  }

  function queryContext(
    file: string,
    requestOptions: ts.Node | undefined,
    key: string,
  ): Record<string, string> | undefined {
    const query = property(file, requestOptions, key);
    const result: Record<string, string> = {};
    // Only caller-selected keys are retained, rather than arbitrary options.
    for (const name of options.queryParameters ?? []) {
      const expression = property(file, query, name);
      const text =
        name === "query"
          ? queryTerms(file, expression)
          : value(file, expression);
      if (text) result[name] = text;
    }
    return Object.keys(result).length ? result : undefined;
  }

  for (const [file, mod] of modules) {
    for (const declaration of mod.declarations.values()) {
      function visit(node: ts.Node): void {
        if (ts.isTypeNode(node)) return;
        if (
          ts.isPropertyAssignment(node) &&
          declarationFlags.has(node.name.getText()) &&
          node.initializer.kind === ts.SyntaxKind.TrueKeyword
        )
          declaration.flags.add(node.name.getText());
        if (
          ts.isPropertyAssignment(node) &&
          node.name.getText() === "method"
        ) {
          const method = value(file, node.initializer);
          if (method) declaration.usage.methods.push(method.toUpperCase());
        }
        if (ts.isCallExpression(node)) {
          const binding = bindingFor(file, node.expression);
          if (binding) declaration.calls.add(`${binding.file}#${binding.name}`);
          const name =
            binding?.name ??
            (ts.isIdentifier(node.expression) ? node.expression.text : "");
          if (boundaries.has(name)) {
            declaration.boundary = true;
            declaration.factories.add(name);
            for (const argument of node.arguments) visit(argument);
            return;
          }
          const operation = binding?.file === SDK ? sdk.get(name) : undefined;
          if (operation) {
            declaration.usage.operations.push({
              ...operation,
              query: queryContext(file, node.arguments[0], "query"),
            });
            declaration.usage.methods.push(operation.method);
            for (const argument of node.arguments) visit(argument);
            return;
          }
          const request = requests.get(name);
          if (request) {
            const requestOptions = node.arguments[request.optionsArgument];
            const methodExpression = property(file, requestOptions, "method");
            const method =
              methodExpression === undefined
                ? (request.defaultMethod ?? "GET").toUpperCase()
                : value(file, methodExpression)?.toUpperCase();
            const path = value(file, node.arguments[request.pathArgument], true);
            const matches =
              method && path
                ? (identities.get(`${method}:${pathKey(path)}`) ?? [])
                : [];
            if (method) declaration.usage.methods.push(method);
            if (matches.length === 1)
              declaration.usage.operations.push({
                ...matches[0]!,
                query: queryContext(file, requestOptions, request.queryProperty ?? "query"),
              });
            else
              declaration.usage.unresolvedRequests.push({
                file,
                line:
                  mod.source.getLineAndCharacterOfPosition(node.getStart())
                    .line + 1,
                method,
                path,
                reason:
                  !method || !path
                    ? "Dynamic request identity"
                    : matches.length
                      ? "Ambiguous catalog path"
                      : "Request is not in the public catalog",
              });
            for (const argument of node.arguments) visit(argument);
            return;
          }
        }
        if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
          const parent = node.parent;
          const isName =
            (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
            ((ts.isPropertyAssignment(parent) ||
              ts.isMethodDeclaration(parent) ||
              ts.isVariableDeclaration(parent) ||
              ts.isParameter(parent) ||
              ts.isFunctionDeclaration(parent)) &&
              parent.name === node);
          if (!isName) {
            const binding = bindingFor(file, node);
            if (binding && !boundaries.has(binding.name)) {
              const operation =
                binding.file === SDK ? sdk.get(binding.name) : undefined;
              if (operation) {
                declaration.usage.operations.push(operation);
                declaration.usage.methods.push(operation.method);
              } else declaration.refs.add(`${binding.file}#${binding.name}`);
            }
          }
        }
        node.forEachChild(visit);
      }
      visit(declaration.node);
    }
  }

  const declarations = new Map<string, Declaration>(
    [...modules].flatMap(([file, mod]) =>
      [...mod.declarations].map(
        ([name, declaration]) => [`${file}#${name}`, declaration] as const,
      ),
    ),
  );
  function unique<T>(items: T[]): T[] {
    return [
      ...new Map(items.map((item) => [JSON.stringify(item), item])).values(),
    ];
  }
  function isAlias(declaration: Declaration, ref: string): boolean {
    const node = unwrap(declaration.node);
    if (!ts.isIdentifier(node) && !ts.isPropertyAccessExpression(node))
      return false;
    const binding = bindingFor(node.getSourceFile().fileName, node);
    return !!binding && `${binding.file}#${binding.name}` === ref;
  }
  // Resolve boundary factories and aliases before propagating usage so objects
  // containing callbacks can be inspected as data without inheriting their calls.
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations.values()) {
      for (const ref of declaration.refs) {
        const child = declarations.get(ref);
        if (
          !child?.boundary ||
          (!declaration.calls.has(ref) && !isAlias(declaration, ref))
        )
          continue;
        if (!declaration.boundary) changed = true;
        declaration.boundary = true;
        for (const factory of child.factories) {
          if (!declaration.factories.has(factory)) changed = true;
          declaration.factories.add(factory);
        }
        for (const flag of child.flags) {
          if (!declaration.flags.has(flag)) changed = true;
          declaration.flags.add(flag);
        }
      }
    }
  }
  changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations.values()) {
      const before = JSON.stringify(declaration.usage);
      for (const ref of declaration.refs) {
        const child = declarations.get(ref);
        if (!child) continue;
        if (
          child.boundary &&
          !ts.isFunctionLike(unwrap(child.node)) &&
          !isAlias(declaration, ref)
        )
          continue;
        declaration.usage.operations.push(...child.usage.operations);
        declaration.usage.unresolvedRequests.push(
          ...child.usage.unresolvedRequests,
        );
        declaration.usage.methods.push(...child.usage.methods);
      }
      declaration.usage.operations = unique(declaration.usage.operations);
      declaration.usage.unresolvedRequests = unique(
        declaration.usage.unresolvedRequests,
      );
      declaration.usage.methods = unique(declaration.usage.methods);
      changed ||= before !== JSON.stringify(declaration.usage);
    }
  }

  const result: SourceApiAnalysis = { exports: new Map(), boundaries: [] };
  function exportNames(file: string, seen = new Set<string>()): string[] {
    if (seen.has(file)) return [];
    seen.add(file);
    const mod = modules.get(file);
    return mod
      ? [
          ...mod.exports.keys(),
          ...mod.stars.flatMap((target) => exportNames(target, seen)),
        ]
      : [];
  }
  for (const [file, mod] of modules) {
    const exported = new Map<string, SourceApiUsage>();
    for (const name of new Set(exportNames(file))) {
      const target = mod.exports.get(name) ?? { file, name };
      const binding = resolve(target);
      const declaration =
        binding && declarations.get(`${binding.file}#${binding.name}`);
      if (!declaration) continue;
      exported.set(name, declaration.usage);
      if (declaration.boundary)
        result.boundaries.push({
          file,
          name,
          factories: [...declaration.factories],
          flags: [...declaration.flags],
        });
    }
    result.exports.set(file, exported);
  }
  return result;
}
