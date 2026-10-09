import { describe, expect, it } from 'vitest';
import {
  blogCategoryUrl,
  blogIndexUrl,
  blogPostUrl,
  blogRssPath,
  blogRssUrl,
} from './blog.urls';
import { localeAbsoluteUrl } from '../routing/locale-url';

const D = 'https://nailfolio.app';

describe('blog urls', () => {
  it('Polish has no prefix and a trailing slash', () => {
    expect(blogIndexUrl('pl')).toBe(`${D}/blog/`);
    expect(blogPostUrl('pl', 'abc')).toBe(`${D}/blog/abc/`);
    expect(blogCategoryUrl('pl', 'how-to-guides')).toBe(
      `${D}/blog/category/how-to-guides/`
    );
    expect(blogRssPath('pl')).toBe('/rss.xml');
  });

  it('English and German carry their prefix', () => {
    expect(blogPostUrl('en', 'abc')).toBe(`${D}/en/blog/abc/`);
    expect(blogIndexUrl('de')).toBe(`${D}/de/blog/`);
    expect(blogRssUrl('en')).toBe(`${D}/en/rss.xml`);
  });

  it('localeAbsoluteUrl normalizes root and trailing slashes', () => {
    expect(localeAbsoluteUrl('pl', '/')).toBe(`${D}/`);
    expect(localeAbsoluteUrl('en', '/')).toBe(`${D}/en/`);
    expect(localeAbsoluteUrl('de', '/pricing/')).toBe(`${D}/de/pricing/`);
  });
});
