import { describe, expect, it } from 'vitest';
import { trailingSlashTarget } from './trailing-slash';

describe('trailingSlashTarget', () => {
  it('adds the slash to page routes', () => {
    expect(trailingSlashTarget('GET', '/get-app')).toBe('/get-app/');
    expect(trailingSlashTarget('HEAD', '/blog/some-post')).toBe(
      '/blog/some-post/'
    );
    expect(trailingSlashTarget('GET', '/stylist/abc123')).toBe(
      '/stylist/abc123/'
    );
  });

  it('leaves canonical and root URLs alone', () => {
    expect(trailingSlashTarget('GET', '/')).toBeNull();
    expect(trailingSlashTarget('GET', '/pricing/')).toBeNull();
  });

  it('never touches files, APIs, Next internals or the PostHog proxy', () => {
    for (const path of [
      '/llms.txt',
      '/blog/post.md',
      '/en/blog/post.md',
      '/sitemap.xml',
      '/rss.xml',
      '/og-default.png',
      '/api/v1/anything',
      '/api',
      '/_next/data/build/en/pricing.json',
      '/ingest/e',
      '/ingest',
      '/.well-known/assetlinks.json',
    ]) {
      expect(trailingSlashTarget('GET', path)).toBeNull();
    }
  });

  it('never redirects a client-side data request, whose path Next normalizes', () => {
    // What middleware really receives for /_next/data/<build>/en/pricing.json.
    expect(trailingSlashTarget('GET', '/pricing', true)).toBeNull();
    expect(trailingSlashTarget('GET', '/pricing', false)).toBe('/pricing/');
  });

  it('never redirects non-GET requests', () => {
    expect(trailingSlashTarget('POST', '/contact')).toBeNull();
    expect(trailingSlashTarget('OPTIONS', '/pricing')).toBeNull();
  });
});
