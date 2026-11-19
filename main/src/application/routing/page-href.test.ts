import { describe, expect, it } from 'vitest';
import { isInternalPageHref, withPageTrailingSlash } from './page-href';

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

describe('isInternalPageHref', () => {
  it('accepts our page paths, with or without a locale prefix', () => {
    for (const href of [
      '/',
      '/pricing',
      '/en/for-stylists/',
      '/blog/post?x=1#y',
    ]) {
      expect(isInternalPageHref(href)).toBe(true);
    }
  });

  it('rejects external, files, API and fragment-only hrefs', () => {
    for (const href of [
      'https://www.aad.org/public',
      '//cdn.example.test/x',
      'mailto:support@nailfolio.app',
      '#section',
      '?tab=clients',
      '/img/blog/hero.webp',
      '/llms.txt',
      '/api/v1/x',
      '/_next/static/x',
    ]) {
      expect(isInternalPageHref(href)).toBe(false);
    }
  });
});
