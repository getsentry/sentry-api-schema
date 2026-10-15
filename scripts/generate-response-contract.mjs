/**
 * Adapt the pinned Fetch generator to the public SDK's fields/error contract.
 * Each replacement fails closed so generator upgrades cannot silently discard it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function replaceOnce(source, before, after) {
  const matches = typeof before === "string"
    ? source.split(before).length - 1
    : [...source.matchAll(new RegExp(before.source, "g"))].length;
  if (matches !== 1) {
    throw new Error(`Fetch generator changed: expected one match, got ${matches}: ${before}`);
  }
  return source.replace(before, () => after);
}

function update(name, transform) {
  const path = fileURLToPath(new URL(`../src/client/${name}.gen.ts`, import.meta.url));
  writeFileSync(path, transform(readFileSync(path, "utf8")));
}

update("client", source => {
  source = replaceOnce(source, "import { createSseClient }", "import { SentryApiError } from '../sentry-errors';\n\nimport { createSseClient }");
  source = replaceOnce(source, "export const createClient = (config: Config = {}): Client => {", `// Reject unsupported configuration instead of changing its meaning at runtime.
const assertFields = (config: { responseStyle?: unknown }): void => {
  if (config.responseStyle !== undefined && config.responseStyle !== 'fields') {
    throw new TypeError('@sentry/api only supports responseStyle: "fields". Read result.data instead.');
  }
};

export const createClient = (config: Config = {}): Client => {
  assertFields(config);`);
  source = replaceOnce(source, "  const setConfig = (config: Config): Config => {", "  const setConfig = (config: Config): Config => {\n    assertFields(config);");
  source = replaceOnce(source, "  const beforeRequest = async (options: RequestOptions) => {", "  const beforeRequest = async (options: RequestOptions) => {\n    assertFields(options);");
  source = replaceOnce(source, "  const request: Client['request'] = async (options) => {\n    // @ts-expect-error", "  // The public Client signature applies operation-specific data and throw types.\n  const request = async (options: RequestOptions) => {");
  source = replaceOnce(source, "      response = await _fetch(request);", `      // Check the final intercepted Request, preserving the fetch-error contract.
      request.signal.throwIfAborted();
      response = await _fetch(request);`);
  source = replaceOnce(source, "finalError = (await fn(error, undefined as any, request, opts)) as unknown;", "finalError = await fn(finalError, undefined, request, opts);");
  source = replaceOnce(source, "      finalError = finalError || ({} as unknown);\n\n", "");
  source = replaceOnce(source, `      // Return error response
      return opts.responseStyle === 'data'
        ? undefined
        : {
            error: finalError,
            request,
            response: undefined as any,
          };`, `      return { error: finalError, request, response: undefined };`);
  source = replaceOnce(source, `        return opts.responseStyle === 'data'
          ? emptyData
          : {
              data: emptyData,
              ...result,
            };`, `        return { data: emptyData, ...result };`);
  source = replaceOnce(source, `          return opts.responseStyle === 'data'
            ? response.body
            : {
                data: response.body,
                ...result,
              };`, `          return { data: response.body, ...result };`);
  source = replaceOnce(source, `      return opts.responseStyle === 'data'
        ? data
        : {
            data,
            ...result,
          };`, `      return { data, ...result };`);
  source = replaceOnce(source, `    let jsonError: unknown;

    try {
      jsonError = JSON.parse(textError);
    } catch {
      // noop
    }

    const error = jsonError ?? textError;
    let finalError = error;`, `    let body: unknown = textError;
    try {
      body = JSON.parse(textError);
    } catch {
      // Non-JSON HTTP error bodies remain available as text.
    }

    // Normalize once, before user interceptors. A custom mapping owns its result.
    let finalError: unknown = new SentryApiError(
      response.status, body, response, false, undefined,
      { request, rawBody: textError },
    );`);
  source = replaceOnce(source, "finalError = (await fn(error, response, request, opts)) as string;", "finalError = await fn(finalError, response, request, opts);");
  source = replaceOnce(source, "    finalError = finalError || ({} as string);\n\n", "");
  source = replaceOnce(source, `    // TODO: we probably want to return error and improve types
    return opts.responseStyle === 'data'
      ? undefined
      : {
          error: finalError,
          ...result,
        };`, `    return { error: finalError, ...result };`);
  return source;
});

update("types", source => {
  source = replaceOnce(source, "import type { Auth }", "import type { SdkResult } from '../sentry-errors';\n\nimport type { Auth }");
  source = replaceOnce(source, "export type ResponseStyle = 'data' | 'fields';", "export type ResponseStyle = 'fields';");
  source = replaceOnce(source, "Should we return only data or multiple fields (data, error, response, etc.)?", "Responses always include fields (data or error, request, response).");
  return replaceOnce(source, /export type RequestResult<[\s\S]*?(?=\nexport interface ClientOptions)/, `export type RequestResult<
  TData = unknown,
  TError = unknown,
  ThrowOnError extends boolean = boolean,
  TResponseStyle extends ResponseStyle = 'fields',
> = Promise<ThrowOnError extends true
  ? {
      data: TData extends Record<string, unknown> ? TData[keyof TData] : TData;
      request: Request;
      response: Response;
    }
  : SdkResult<TData extends Record<string, unknown> ? TData[keyof TData] : TData>>;
`);
});

update("utils", source => replaceOnce(source,
  "  error: Err,\n  response: Res,",
  "  error: Err,\n  response: Res | undefined,",
));
