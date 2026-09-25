/**
 * Auth + client configuration factories for @sentry/api.
 *
 * Configure a client once, or create an isolated client for each deployment
 * and authentication context. Browser session configuration lives in ./browser.
 */

/** Standard fetch signature, without Bun/Node runtime extensions. */
export type FetchFn = (input: string | Request | URL, init?: RequestInit) => Promise<Response>;

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
 * Default API origin for Sentry's public cloud.
 */
export const DEFAULT_BASE_URL = 'https://sentry.io';

export type BearerTokenOptions = {
  /** Auth token, sent as `Authorization: Bearer <token>`. */
  token: string;
  /**
   * API origin, defaulting to https://sentry.io. Explicit Enterprise,
   * self-hosted, and regional hosts are preserved without region discovery.
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
};

/**
 * Config for Bearer authentication against the selected Sentry deployment.
 *
 * @example
 * import { client, bearerToken } from '@sentry/api';
 * client.setConfig(bearerToken({ token: 'your-auth-token' }));
 */
export function bearerToken(opts: BearerTokenOptions): SentryApiConfig {
  const config: SentryApiConfig = {
    baseUrl: opts.baseUrl ?? DEFAULT_BASE_URL,
    headers: { Authorization: `Bearer ${opts.token}`, ...opts.headers },
  };
  if (opts.fetch) {
    config.fetch = opts.fetch;
  }
  if (opts.throwOnError !== undefined) {
    config.throwOnError = opts.throwOnError;
  }
  return config;
}
