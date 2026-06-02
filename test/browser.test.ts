import {describe, expect, it} from 'bun:test';
import {createBrowserFetch, createBrowserSdkConfig, type FetchFn} from '../lib/browser-client.ts';

// Helper to capture headers/init from a fetch call
function captureFetch(): {mock: FetchFn; captured: {headers?: Headers; init?: RequestInit}} {
  const captured: {headers?: Headers; init?: RequestInit} = {};
  const mock: FetchFn = async (_input, init) => {
    captured.headers = new Headers(init?.headers);
    captured.init = init;
    return new Response('{}', {status: 200});
  };
  return {mock, captured};
}

async function withMockFetch<T>(mock: FetchFn, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = mock as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

describe('createBrowserFetch', () => {
  it('injects X-CSRFToken on POST', async () => {
    const {mock, captured} = captureFetch();
    const browserFetch = createBrowserFetch({getCsrfToken: () => 'test-csrf-token'});
    await withMockFetch(mock, () => browserFetch('/api/0/projects/', {method: 'POST', body: '{}'}));
    expect(captured.headers?.get('X-CSRFToken')).toBe('test-csrf-token');
  });

  it('injects X-CSRFToken on PUT', async () => {
    const {mock, captured} = captureFetch();
    const browserFetch = createBrowserFetch({getCsrfToken: () => 'test-csrf-token'});
    await withMockFetch(mock, () => browserFetch('/api/0/projects/my-proj/', {method: 'PUT', body: '{}'}));
    expect(captured.headers?.get('X-CSRFToken')).toBe('test-csrf-token');
  });

  it('injects X-CSRFToken on PATCH', async () => {
    const {mock, captured} = captureFetch();
    const browserFetch = createBrowserFetch({getCsrfToken: () => 'test-csrf-token'});
    await withMockFetch(mock, () => browserFetch('/api/0/projects/my-proj/', {method: 'PATCH', body: '{}'}));
    expect(captured.headers?.get('X-CSRFToken')).toBe('test-csrf-token');
  });

  it('injects X-CSRFToken on DELETE', async () => {
    const {mock, captured} = captureFetch();
    const browserFetch = createBrowserFetch({getCsrfToken: () => 'token'});
    await withMockFetch(mock, () => browserFetch('/api/0/projects/my-proj/', {method: 'DELETE'}));
    expect(captured.headers?.get('X-CSRFToken')).toBe('token');
  });

  it('does not inject X-CSRFToken on GET with explicit method', async () => {
    const {mock, captured} = captureFetch();
    const browserFetch = createBrowserFetch({getCsrfToken: () => 'test-csrf-token'});
    await withMockFetch(mock, () => browserFetch('/api/0/projects/', {method: 'GET'}));
    expect(captured.headers?.get('X-CSRFToken')).toBeNull();
  });

  it('does not inject X-CSRFToken when called with no init (defaults to GET)', async () => {
    const {mock, captured} = captureFetch();
    const browserFetch = createBrowserFetch({getCsrfToken: () => 'test-csrf-token'});
    await withMockFetch(mock, () => browserFetch('/api/0/projects/'));
    expect(captured.headers?.get('X-CSRFToken')).toBeNull();
  });

  it('does not inject X-CSRFToken on HEAD', async () => {
    const {mock, captured} = captureFetch();
    const browserFetch = createBrowserFetch({getCsrfToken: () => 'token'});
    await withMockFetch(mock, () => browserFetch('/api/0/projects/', {method: 'HEAD'}));
    expect(captured.headers?.get('X-CSRFToken')).toBeNull();
  });

  it('does not inject empty CSRF token', async () => {
    const {mock, captured} = captureFetch();
    const browserFetch = createBrowserFetch({getCsrfToken: () => ''});
    await withMockFetch(mock, () => browserFetch('/api/0/projects/', {method: 'POST'}));
    expect(captured.headers?.has('X-CSRFToken')).toBe(false);
  });

  it('sets credentials: include', async () => {
    const {mock, captured} = captureFetch();
    const browserFetch = createBrowserFetch({getCsrfToken: () => 'token'});
    await withMockFetch(mock, () => browserFetch('/api/0/projects/', {method: 'POST'}));
    expect(captured.init?.credentials).toBe('include');
  });

  it('overrides caller-provided credentials with include', async () => {
    const {mock, captured} = captureFetch();
    const browserFetch = createBrowserFetch({getCsrfToken: () => 'token'});
    await withMockFetch(mock, () => browserFetch('/api/0/projects/', {method: 'GET', credentials: 'omit'}));
    expect(captured.init?.credentials).toBe('include');
  });
});

describe('createBrowserSdkConfig', () => {
  it('returns empty baseUrl by default', () => {
    const config = createBrowserSdkConfig();
    expect(config.baseUrl).toBe('');
  });

  it('accepts custom baseUrl', () => {
    const config = createBrowserSdkConfig({baseUrl: 'https://sentry.io'});
    expect(config.baseUrl).toBe('https://sentry.io');
  });

  it('returns a fetch function', () => {
    const config = createBrowserSdkConfig();
    expect(typeof config.fetch).toBe('function');
  });
});
