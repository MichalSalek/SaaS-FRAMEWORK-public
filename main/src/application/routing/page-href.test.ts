import { describe, expect, it } from 'vitest';
import { withPageTrailingSlash } from './page-href';

describe('withPageTrailingSlash', () => {
  it('adds the slash to page paths, keeping query and hash', () => {
    expect(withPageTrailingSlash('/blog')).toBe('/blog/');
    expect(withPageTrailingSlash('/blog/some-post')).toBe('/blog/some-post/');
    expect(withPageTrailingSlash('/user/login?intent=register')).toBe(
      '/user/login/?intent=register'
    );
    expect(withPageTrailingSlash('/help-center#faq')).toBe('/help-center/#faq');
  });

  it('leaves canonical, root, external and non-page hrefs alone', () => {
    for (const href of [
      '/',
      '/pricing/',
      '/pricing/?plan=pro',
      'https://www.instagram.com/nailfolio.app',
      '//cdn.example.test/x',
      'mailto:support@nailfolio.app',
      '#section',
      '?tab=clients',
      '/llms.txt',
      '/blog/post.md',
      '/og-default.png',
      '/api/v1/anything',
      '/ingest/e',
      '/_next/static/chunk.js',
      '/.well-known/assetlinks.json',
    ]) {
      expect(withPageTrailingSlash(href)).toBe(href);
    }
  });
});
