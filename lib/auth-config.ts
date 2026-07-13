/**
 * Auth + client configuration factories for @sentry/api.
 *
 * These are small, pure builders: they return a plain, typed config object that
 * you hand to the SDK client, either globally via `client.setConfig(...)` or to
 * an isolated instance via `createSentryClient(...)`. No side effects, no hidden
 * lifecycle, no `mode` enum. If you prefer, pass the raw object yourself.
 *
 * Factories are named by authentication method (`bearerToken`; `browserSession`
 * lives in ./browser). Host and routing are options, not separate factories.
 */

import {
  createDefaultRegionResolver,
  createRegionRoutingFetch,
  type ResolveRegionUrl,
} from './region-routing.ts';

export type {ResolveRegionUrl} from './region-routing.ts';

/** Standard fetch signature, without Bun/Node runtime extensions. */
export type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * The subset of the generated client `Config` these factories populate.
 *
 * Declared locally (not imported from the generated client) so this module
 * stays standalone and unit-testable, mirroring `sentry-pagination.ts`. It is
 * structurally compatible with the client's `Config`, so the result drops
 * straight into `client.setConfig(...)` or `createSentryClient(...)`.
 */
export type SentryApiConfig = {
  baseUrl?: string;
  fetch?: FetchFn;
  headers?: Record<string, string>;
  throwOnError?: boolean;
};

/**
 * Default host for Sentry's multi-region cloud. Its proxy routes org-scoped
 * requests (the SDK's surface is org-scoped) to the correct region using the
 * org slug in the path, so most consumers never need to think about regions.
 */
export const DEFAULT_BASE_URL = 'https://sentry.io';

export type BearerTokenOptions = {
  /** Auth token, sent as `Authorization: Bearer <token>`. */
  token: string;
  /**
   * Base URL. Defaults to https://sentry.io (cloud), where the proxy routes by
   * org slug. Set it for self-hosted or to pin a single region.
   */
  baseUrl?: string;
  /**
   * Custom fetch, for transport policy the SDK does not own: token refresh,
   * retries, timeouts, custom CA, tracing. If it sets its own Authorization
   * header, that wins over the bearer token here.
   */
  fetch?: FetchFn;
  /** Extra headers merged into every request (e.g. `User-Agent`). */
  headers?: Record<string, string>;
  /** When true, SDK calls throw on error instead of returning `{ data, error }`. */
  throwOnError?: boolean;
  /**
   * Opt-in direct region routing (lower latency; skips the sentry.io proxy hop).
   * Pass your own resolver, or `true` to use the built-in one
   * (`GET /organizations/{slug}/` -> `links.regionUrl`, cached). Omit it (the
   * default) to stay on `baseUrl` and let the proxy route by the org slug.
   */
  resolveRegionUrl?: ResolveRegionUrl | true;
};

/**
 * Config for token auth against Sentry (cloud or self-hosted).
 *
 * @example
 * import { client, bearerToken } from '@sentry/api';
 * client.setConfig(bearerToken({ token: process.env.SENTRY_AUTH_TOKEN }));
 */
export function bearerToken(opts: BearerTokenOptions): SentryApiConfig {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const headers = { Authorization: `Bearer ${opts.token}`, ...opts.headers };
  const config: SentryApiConfig = { baseUrl, headers };

  if (opts.resolveRegionUrl) {
    const resolver =
      opts.resolveRegionUrl === true
        ? createDefaultRegionResolver({ baseUrl, fetch: opts.fetch, headers })
        : opts.resolveRegionUrl;
    config.fetch = createRegionRoutingFetch({ fetch: opts.fetch, resolveRegionUrl: resolver });
  } else if (opts.fetch) {
    config.fetch = opts.fetch;
  }

  if (opts.throwOnError !== undefined) {
    config.throwOnError = opts.throwOnError;
  }
  return config;
}
