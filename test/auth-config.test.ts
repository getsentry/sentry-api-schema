import {describe, expect, it} from 'bun:test';
import {bearerToken, DEFAULT_BASE_URL, type FetchFn} from '../lib/auth-config.ts';
import {browserSession, createBrowserSdkConfig} from '../lib/browser-client.ts';

describe('bearerToken', () => {
  it('defaults baseUrl to the Sentry cloud host', () => {
    const config = bearerToken({token: 't'});
    expect(config.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(DEFAULT_BASE_URL).toBe('https://sentry.io');
  });

  it('sets the Authorization: Bearer header', () => {
    const config = bearerToken({token: 'abc123'});
    expect(config.headers?.Authorization).toBe('Bearer abc123');
  });

  it('honors a custom baseUrl (self-hosted / pinned region)', () => {
    const config = bearerToken({token: 't', baseUrl: 'https://sentry.acme.com'});
    expect(config.baseUrl).toBe('https://sentry.acme.com');
  });

  it('merges extra headers alongside Authorization', () => {
    const config = bearerToken({token: 't', headers: {'User-Agent': 'sentry-cli/1.0'}});
    expect(config.headers?.Authorization).toBe('Bearer t');
    expect(config.headers?.['User-Agent']).toBe('sentry-cli/1.0');
  });

  it('lets a caller header override the default (last write wins)', () => {
    const config = bearerToken({token: 't', headers: {Authorization: 'Bearer override'}});
    expect(config.headers?.Authorization).toBe('Bearer override');
  });

  it('passes through a custom fetch and throwOnError', () => {
    const fetch: FetchFn = async () => new Response('{}');
    const config = bearerToken({token: 't', fetch, throwOnError: true});
    expect(config.fetch).toBe(fetch);
    expect(config.throwOnError).toBe(true);
  });

  it('omits fetch and throwOnError when not provided', () => {
    const config = bearerToken({token: 't'});
    expect(config.fetch).toBeUndefined();
    expect(config.throwOnError).toBeUndefined();
  });
});

describe('browserSession', () => {
  it('is the blessed alias of createBrowserSdkConfig (same shape)', () => {
    const a = browserSession();
    const b = createBrowserSdkConfig();
    expect(a.baseUrl).toBe(b.baseUrl);
    expect(a.baseUrl).toBe('');
    expect(typeof a.fetch).toBe('function');
  });
});
