/**
 * Sentry API pagination utilities.
 *
 * Sentry uses cursor-based pagination via HTTP Link headers.
 * These helpers make it ergonomic to paginate through results
 * returned by the generated SDK functions.
 */

// This type mirrors the SDK's RequestResult<TData, TError, false, 'fields'>
// discriminated union shape. We define it locally so this module has zero
// imports from generated code — it must remain self-contained.
type SdkResult<TData = unknown, TError = unknown> = (
  | { data: TData; error: undefined }
  | { data: undefined; error: TError }
) & {
  request: Request;
  response: Response;
};

export type UnwrappedResult<TData> = {
  data: TData;
  response: Response;
};

export type PaginatedResponse<T> = {
  data: T;
  nextCursor?: string;
};

export type PaginateAllOptions = {
  maxPages?: number;
};

export type PageFetcher<TData, TError> = (
  cursor: string | undefined,
) => Promise<SdkResult<TData, TError>>;

/**
 * Parse Sentry's Link header to extract the next page cursor.
 *
 * Sentry returns Link headers in the format:
 *   <url>; rel="previous"; results="false"; cursor="...";,
 *   <url>; rel="next"; results="true"; cursor="1234:0:0";
 *
 * Returns `{ nextCursor }` if there is a next page, or `{}` if not.
 */
export const parseSentryLinkHeader = (
  header: string | null,
): { nextCursor?: string } => {
  if (!header) {
    return {};
  }

  const segments = header.split(",");

  for (const segment of segments) {
    const parts = segment.trim().split(";").map((s) => s.trim());

    let rel: string | undefined;
    let results: string | undefined;
    let cursor: string | undefined;

    for (const part of parts) {
      const relMatch = part.match(/^rel="([^"]*)"$/);
      if (relMatch) {
        rel = relMatch[1];
        continue;
      }
      const resultsMatch = part.match(/^results="([^"]*)"$/);
      if (resultsMatch) {
        results = resultsMatch[1];
        continue;
      }
      const cursorMatch = part.match(/^cursor="([^"]*)"$/);
      if (cursorMatch) {
        cursor = cursorMatch[1];
        continue;
      }
    }

    if (rel === "next" && results === "true" && cursor) {
      return { nextCursor: cursor };
    }
  }

  return {};
};

/**
 * Unwrap an SDK result, throwing on error.
 *
 * Returns `{ data, response }` so callers retain access to the
 * raw Response (and its headers) for pagination or other needs.
 */
export const unwrapResult = <TData>(
  result: SdkResult<TData>,
  context: string,
): UnwrappedResult<TData> => {
  if (result.error !== undefined) {
    throw new Error(
      `${context}: API request failed: ${JSON.stringify(result.error)}`,
    );
  }
  return { data: result.data as TData, response: result.response };
};

/**
 * Unwrap an SDK result and extract the next-page cursor from the
 * Link header. Throws on error.
 *
 * Returns `{ data, nextCursor? }` — if `nextCursor` is undefined,
 * there are no more pages.
 */
export const unwrapPaginatedResult = <TData>(
  result: SdkResult<TData>,
  context: string,
): PaginatedResponse<TData> => {
  const { data, response } = unwrapResult(result, context);
  const linkHeader = response.headers.get("link");
  const { nextCursor } = parseSentryLinkHeader(linkHeader);
  return { data, nextCursor };
};

/**
 * Automatically paginate through all pages of a Sentry list endpoint.
 *
 * Fetches pages sequentially until there is no next cursor or
 * `maxPages` is reached (default: 50). Returns all items concatenated.
 *
 * @example
 * ```ts
 * const allRepos = await paginateAll(
 *   (cursor) => listAnOrganization_sRepositories({
 *     path: { organization_id_or_slug: 'my-org' },
 *     query: { cursor },
 *   }),
 *   'listRepos',
 * );
 * ```
 */
export const paginateAll = async <TItem, TError = unknown>(
  fetcher: PageFetcher<Array<TItem>, TError>,
  context: string,
  options?: PaginateAllOptions,
): Promise<Array<TItem>> => {
  const maxPages = options?.maxPages ?? 50;
  const allItems: Array<TItem> = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const result = await fetcher(cursor);
    const { data, nextCursor } = unwrapPaginatedResult(result, context);
    allItems.push(...data);

    if (!nextCursor) {
      break;
    }
    cursor = nextCursor;
  }

  return allItems;
};
