/**
 * Progressive-accuracy queries for @sentry/api.
 *
 * Sentry's Explore/EAP endpoints (e.g. `listOrganizationEvents`) may answer a
 * query from a downsampled storage tier. When they do, the response meta carries
 * `dataScanned: 'partial'`, and a targeted query (an exact-id lookup) can come
 * back empty even though the row exists. The fix, which the Sentry frontend
 * already implements in `useProgressiveQuery`, is to retry the same query at
 * `HIGHEST_ACCURACY` when the first (cheap) pass scanned only partially.
 *
 * This is the shared, transport-agnostic core of that pattern so the CLI, MCP,
 * and frontend do not each reimplement it (the CLI `log view` bug was the cost
 * of not sharing it). Standalone, no generated imports, like the other helpers.
 *
 * NOTE: the `sampling` query parameter is accepted by the API at runtime but is
 * not yet in the OpenAPI spec, so it is not on the generated query types. Pass
 * it with a narrow cast for now; a backend `@extend_schema` follow-up will type
 * it. `dataScanned` IS typed on the events response meta.
 */

/** Sampling modes the EAP `sampling` query param accepts (subset used here). */
export const SAMPLING_MODE = {
  NORMAL: 'NORMAL',
  HIGH_ACCURACY: 'HIGHEST_ACCURACY',
} as const;

export type SamplingMode = (typeof SAMPLING_MODE)[keyof typeof SAMPLING_MODE];

/**
 * Default escalation predicate: retry when the first pass reports a partial scan.
 * Tolerates both the raw SDK result (`{ data: { meta } }`) and an unwrapped
 * response (`{ meta }`). Mirrors the frontend's condition.
 */
export function isPartialScan(result: unknown): boolean {
  const r = result as {data?: {meta?: {dataScanned?: string}}; meta?: {dataScanned?: string}};
  const dataScanned = r?.data?.meta?.dataScanned ?? r?.meta?.dataScanned;
  return dataScanned === 'partial';
}

export type QueryWithAccuracyOptions<T> = {
  /**
   * Return `true` to re-run `queryFn` at `HIGHEST_ACCURACY`. Defaults to
   * {@link isPartialScan}. Override for stricter conditions, e.g. only escalate
   * when the partial scan also came back empty (exact-id lookups).
   */
  shouldEscalate?: (result: T) => boolean;
};

/**
 * Run a query at NORMAL sampling; if `shouldEscalate` says so, re-run it once at
 * HIGHEST_ACCURACY and return that instead. `queryFn` receives the sampling mode
 * and is responsible for placing it in the request (e.g. `query: { sampling }`),
 * so this helper stays independent of query shape and param naming.
 *
 * @example
 * const result = await queryWithAccuracy(
 *   (sampling) => listOrganizationEvents({
 *     path: { organization_id_or_slug: org },
 *     query: { ...query, sampling } as typeof query & { sampling: string },
 *   }),
 *   { shouldEscalate: (r) => isPartialScan(r) && !r.data?.data?.length },
 * );
 */
export async function queryWithAccuracy<T>(
  queryFn: (sampling: SamplingMode) => Promise<T>,
  opts: QueryWithAccuracyOptions<T> = {},
): Promise<T> {
  const shouldEscalate = opts.shouldEscalate ?? (isPartialScan as (result: T) => boolean);
  const normal = await queryFn(SAMPLING_MODE.NORMAL);
  if (shouldEscalate(normal)) {
    return queryFn(SAMPLING_MODE.HIGH_ACCURACY);
  }
  return normal;
}
