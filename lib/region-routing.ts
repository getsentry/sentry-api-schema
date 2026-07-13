/**
 * Opt-in direct region routing for @sentry/api.
 *
 * Sentry's cloud is multi-region. By default a consumer points at https://sentry.io
 * and the proxy routes each org-scoped request to the right region using the org
 * slug in the path; that needs zero region code here. This module is the *opt-in*
 * alternative: resolve an org's region once and hit it directly, skipping the proxy
 * hop for lower latency (first-party CLI/MCP, power users).
 *
 * The routing is done in a per-request `fetch` wrapper: it reads the org slug from
 * the assembled request URL, resolves the region (cached), and rewrites the origin.
 * Per-request means concurrent requests to different regions never share mutable
 * state, so fan-out stays correct without locks or AsyncLocalStorage.
 *
 * Standalone (local types, no generated imports) so it stays unit-testable, like
 * `sentry-pagination.ts` and `auth-config.ts`.
 */

/** Standard fetch signature, without Bun/Node runtime extensions. */
export type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Resolves an org slug to its region base URL (e.g. `https://us.sentry.io`).
 * Return `undefined`/`null` to leave the request on the default host (self-hosted,
 * unknown org, or a lookup failure). May be sync or async.
 */
export type ResolveRegionUrl = (
  orgSlug: string,
) => string | undefined | null | Promise<string | undefined | null>;

/**
 * Pull the org slug out of a Sentry API URL. Handles both org-scoped
 * (`/api/0/organizations/{slug}/...`) and legacy project-scoped
 * (`/api/0/projects/{orgSlug}/{project}/...`) shapes, where the slug is the
 * segment after `organizations/` or `projects/`.
 */
export function extractOrgSlug(url: string): string | undefined {
  let pathname: string;
  try {
    // Base handles relative URLs; we only read the pathname.
    pathname = new URL(url, 'https://relative.invalid').pathname;
  } catch {
    return undefined;
  }
  const match = pathname.match(/\/(?:organizations|projects)\/([^/]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

/** Swap a URL's origin (protocol + host) for the region's, keeping path + query. */
function rewriteOrigin(url: string, regionBaseUrl: string): string {
  const target = new URL(url);
  const region = new URL(regionBaseUrl);
  target.protocol = region.protocol;
  target.host = region.host;
  return target.href;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * Wrap a fetch so org-scoped requests route directly to their region.
 *
 * Requests with no resolvable org slug, or whose org resolves to no region,
 * pass through to `fetch` unchanged (staying on the default host).
 */
export function createRegionRoutingFetch(opts: {
  /** Underlying fetch (may itself carry auth/retries). Defaults to global fetch. */
  fetch?: FetchFn;
  resolveRegionUrl: ResolveRegionUrl;
}): FetchFn {
  const baseFetch: FetchFn = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));

  return async (input, init) => {
    const url = urlOf(input);
    const orgSlug = extractOrgSlug(url);
    if (!orgSlug) return baseFetch(input, init);

    // A region lookup (or a malformed region URL) must never fail the request:
    // fall back to the default host, where the proxy still routes by org slug.
    let rewritten: string;
    try {
      const regionUrl = await opts.resolveRegionUrl(orgSlug);
      if (!regionUrl) return baseFetch(input, init);
      rewritten = rewriteOrigin(url, regionUrl);
    } catch {
      return baseFetch(input, init);
    }

    // Preserve a Request body/headers by reconstructing it; strings/URLs just swap.
    if (input instanceof Request) {
      return baseFetch(new Request(rewritten, input), init);
    }
    return baseFetch(rewritten, init);
  };
}

/**
 * Built-in resolver: look up an org's region via `GET /organizations/{slug}/`
 * and read `links.regionUrl`. Results are cached and in-flight calls deduped,
 * so only one lookup fires per org even under concurrent fan-out.
 *
 * A successful lookup with no region (self-hosted) resolves to `undefined` and
 * is cached (the request stays on the default host). A failed lookup (network
 * error or non-OK response) rejects and is evicted, so a later call retries;
 * `createRegionRoutingFetch` catches that and falls back to the default host,
 * so a lookup failure degrades to proxy routing rather than failing the request.
 *
 * The lookup itself goes to `baseUrl` (the default/control host), which serves
 * org metadata for every region.
 */
export function createDefaultRegionResolver(opts: {
  baseUrl: string;
  /** Fetch used for the lookup; should carry auth. */
  fetch: FetchFn;
  /** Auth/other headers to send on the lookup (e.g. Authorization). */
  headers?: Record<string, string>;
}): ResolveRegionUrl {
  const cache = new Map<string, Promise<string | undefined>>();
  const base = opts.baseUrl.replace(/\/$/, '');

  return (orgSlug: string) => {
    const cached = cache.get(orgSlug);
    if (cached) return cached;

    const promise = (async (): Promise<string | undefined> => {
      // Network errors reject here (not caught), so the failure is evicted below
      // and retried on the next call rather than cached as a permanent miss.
      const res = await opts.fetch(`${base}/api/0/organizations/${orgSlug}/`, {
        method: 'GET',
        headers: opts.headers,
      });
      if (!res.ok) {
        throw new Error(`region lookup for "${orgSlug}" failed: HTTP ${res.status}`);
      }
      const body = (await res.json()) as { links?: { regionUrl?: string } };
      // 200 with no regionUrl means self-hosted / single-region: cache undefined.
      return body?.links?.regionUrl || undefined;
    })();

    cache.set(orgSlug, promise);
    // Evict failed lookups (network / non-OK) so a later call retries instead of
    // caching the failure. A resolved value (a region, or undefined for
    // self-hosted) stays cached.
    promise.catch(() => cache.delete(orgSlug));
    return promise;
  };
}
