/**
 * Browser auth utilities for @sentry/api.
 *
 * Provides a fetch wrapper that handles cookie-based session auth and
 * CSRF token injection, allowing the SDK to be used inside the Sentry
 * frontend without a Bearer token.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

/** Matches the standard fetch signature without Bun/Node runtime extensions. */
type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type BrowserClientOptions = {
  /** Cookie name to read the CSRF token from. Defaults to 'sc' (Sentry's Django default). */
  csrfCookieName?: string;
  /** Override the CSRF token getter — useful for testing. */
  getCsrfToken?: () => string;
  /** Base URL for all requests. Defaults to '' (same-origin relative URLs). */
  baseUrl?: string;
};

function readCookie(name: string): string {
  // SSR / Node environments have no document; return empty so no token is injected.
  if (typeof document === 'undefined') return '';
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp(`(?:^|; )${escapedName}=([^;]*)`));
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    // Fall back to raw value if the cookie is malformed percent-encoded.
    return match[1]!;
  }
}

/**
 * Returns a fetch wrapper that injects X-CSRFToken on state-changing requests
 * and sends session cookies via credentials: 'include'.
 *
 * Sentry's Django backend reads the CSRF token from the 'sc' cookie by default
 * (configurable via window.csrfCookieName in the frontend).
 *
 * Note: always sets credentials: 'include'; any credentials value in init is overridden.
 */
export function createBrowserFetch(opts: BrowserClientOptions = {}): FetchFn {
  const getCsrf = opts.getCsrfToken ?? (() => readCookie(opts.csrfCookieName ?? 'sc'));

  return (input, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    if (!SAFE_METHODS.has(method)) {
      const token = getCsrf();
      if (token) headers.set('X-CSRFToken', token);
    }
    return globalThis.fetch(input, {...init, headers, credentials: 'include'});
  };
}

/**
 * Returns options to spread into any @sentry/api SDK call from a browser context.
 * Configures relative base URL and cookie+CSRF auth automatically.
 *
 * @example
 * import {client} from '@sentry/api';
 * import {createBrowserSdkConfig} from '@sentry/api/browser';
 * client.setConfig(createBrowserSdkConfig());
 */
export function createBrowserSdkConfig(opts: BrowserClientOptions = {}) {
  return {
    baseUrl: opts.baseUrl ?? '',
    fetch: createBrowserFetch(opts),
  } as const;
}
