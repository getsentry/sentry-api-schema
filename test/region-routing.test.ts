import {describe, expect, it} from 'bun:test';
import {
  createDefaultRegionResolver,
  createRegionRoutingFetch,
  extractOrgSlug,
  type FetchFn,
} from '../lib/region-routing.ts';
import {bearerToken} from '../lib/auth-config.ts';

/** A fetch that records the URL it was called with and returns 200. */
function recordingFetch(body = '{}'): {fetch: FetchFn; urls: string[]} {
  const urls: string[] = [];
  const fetch: FetchFn = async (input) => {
    urls.push(input instanceof Request ? input.url : input instanceof URL ? input.href : input);
    return new Response(body, {status: 200});
  };
  return {fetch, urls};
}

describe('extractOrgSlug', () => {
  it('reads the slug from an org-scoped path', () => {
    expect(extractOrgSlug('https://sentry.io/api/0/organizations/my-org/projects/')).toBe('my-org');
  });

  it('reads the org slug from a legacy project-scoped path', () => {
    expect(extractOrgSlug('https://sentry.io/api/0/projects/my-org/my-proj/')).toBe('my-org');
  });

  it('returns undefined for the org list (no slug)', () => {
    expect(extractOrgSlug('https://sentry.io/api/0/organizations/')).toBeUndefined();
  });

  it('returns undefined when there is no org/project segment', () => {
    expect(extractOrgSlug('https://sentry.io/api/0/broadcasts/')).toBeUndefined();
  });

  it('handles relative URLs', () => {
    expect(extractOrgSlug('/api/0/organizations/acme/issues/')).toBe('acme');
  });
});

describe('createRegionRoutingFetch', () => {
  it('rewrites the origin to the region, preserving path + query', async () => {
    const {fetch, urls} = recordingFetch();
    const routed = createRegionRoutingFetch({fetch, resolveRegionUrl: () => 'https://us.sentry.io'});
    await routed('https://sentry.io/api/0/organizations/my-org/projects/?per_page=100');
    expect(urls[0]).toBe('https://us.sentry.io/api/0/organizations/my-org/projects/?per_page=100');
  });

  it('passes through unchanged when there is no org slug', async () => {
    const {fetch, urls} = recordingFetch();
    const routed = createRegionRoutingFetch({fetch, resolveRegionUrl: () => 'https://us.sentry.io'});
    await routed('https://sentry.io/api/0/organizations/');
    expect(urls[0]).toBe('https://sentry.io/api/0/organizations/');
  });

  it('passes through when the resolver yields no region (self-hosted / unknown)', async () => {
    const {fetch, urls} = recordingFetch();
    const routed = createRegionRoutingFetch({fetch, resolveRegionUrl: () => undefined});
    await routed('https://sentry.io/api/0/organizations/my-org/');
    expect(urls[0]).toBe('https://sentry.io/api/0/organizations/my-org/');
  });

  it('routes concurrent requests to different regions independently', async () => {
    const {fetch, urls} = recordingFetch();
    const routed = createRegionRoutingFetch({
      fetch,
      resolveRegionUrl: (org) => (org === 'us-org' ? 'https://us.sentry.io' : 'https://de.sentry.io'),
    });
    await Promise.all([
      routed('https://sentry.io/api/0/organizations/us-org/'),
      routed('https://sentry.io/api/0/organizations/de-org/'),
    ]);
    expect(urls.sort()).toEqual([
      'https://de.sentry.io/api/0/organizations/de-org/',
      'https://us.sentry.io/api/0/organizations/us-org/',
    ]);
  });
});

describe('createDefaultRegionResolver', () => {
  it('reads links.regionUrl and caches per org (one lookup)', async () => {
    let calls = 0;
    const fetch: FetchFn = async () => {
      calls += 1;
      return new Response(JSON.stringify({links: {regionUrl: 'https://us.sentry.io'}}), {status: 200});
    };
    const resolve = createDefaultRegionResolver({baseUrl: 'https://sentry.io', fetch});
    expect(await resolve('my-org')).toBe('https://us.sentry.io');
    expect(await resolve('my-org')).toBe('https://us.sentry.io');
    expect(calls).toBe(1);
  });

  it('resolves undefined on a non-OK lookup', async () => {
    const fetch: FetchFn = async () => new Response('nope', {status: 404});
    const resolve = createDefaultRegionResolver({baseUrl: 'https://sentry.io', fetch});
    expect(await resolve('my-org')).toBeUndefined();
  });

  it('hits the default host org-metadata path with provided headers', async () => {
    const seen: {url?: string; auth?: string} = {};
    const fetch: FetchFn = async (input, init) => {
      seen.url = input as string;
      seen.auth = new Headers(init?.headers).get('Authorization') ?? undefined;
      return new Response(JSON.stringify({links: {regionUrl: 'https://us.sentry.io'}}), {status: 200});
    };
    const resolve = createDefaultRegionResolver({
      baseUrl: 'https://sentry.io',
      fetch,
      headers: {Authorization: 'Bearer t'},
    });
    await resolve('acme');
    expect(seen.url).toBe('https://sentry.io/api/0/organizations/acme/');
    expect(seen.auth).toBe('Bearer t');
  });
});

describe('bearerToken({ resolveRegionUrl })', () => {
  it('installs a routing fetch when a resolver is given', async () => {
    const {fetch, urls} = recordingFetch();
    const config = bearerToken({token: 't', fetch, resolveRegionUrl: () => 'https://eu.sentry.io'});
    expect(config.headers?.Authorization).toBe('Bearer t');
    await config.fetch!('https://sentry.io/api/0/organizations/o/');
    expect(urls[0]).toBe('https://eu.sentry.io/api/0/organizations/o/');
  });

  it('leaves fetch unset when no resolver and no custom fetch', () => {
    const config = bearerToken({token: 't'});
    expect(config.fetch).toBeUndefined();
  });
});
