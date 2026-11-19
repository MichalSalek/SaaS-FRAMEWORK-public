import { describe, expect, it } from 'vitest';
import type { BlogPost, BlogTranslationGroup } from './blog.types';
import { getPostBySlug, resolveBlogTranslationGroup } from './blog.utils';

const group: BlogTranslationGroup = {
  id: 'article-1',
  slugs: { pl: 'wpis-pl', en: 'post-en', de: 'artikel-de' },
};
function fixture() {
  return Object.fromEntries(
    (['pl', 'en', 'de'] as const).map(locale => [
      locale,
      {
        slug: group.slugs[locale],
        locale,
        title: locale,
        description: locale,
        date: '2026-11-06',
        updated: null,
        category: 'how-to-guides',
        keywords: [],
        author: 'Nailfolio',
        coverImage: '',
        readingTime: 1,
        translationGroup: structuredClone(group),
      } satisfies BlogPost,
    ])
  );
}
describe('explicit reciprocal blog translations', () => {
  it('resolves three reviewed equivalents with different slugs', () => {
    const posts = fixture();
    const load = (slug: string, locale: string) =>
      posts[locale]?.slug === slug ? posts[locale] : null;
    for (const locale of ['pl', 'en', 'de']) {
      expect(resolveBlogTranslationGroup(posts[locale], load)).toEqual(group);
    }
  });
  it('does not invent a cluster for missing or mismatched members', () => {
    const posts = fixture();
    const load = (slug: string, locale: string) =>
      posts[locale]?.slug === slug ? posts[locale] : null;
    delete posts.de;
    expect(resolveBlogTranslationGroup(posts.pl, load)).toBeNull();
    const other = fixture();
    other.de.translationGroup = { ...group, id: 'different' };
    expect(
      resolveBlogTranslationGroup(other.pl, (slug, locale) =>
        other[locale]?.slug === slug ? other[locale] : null
      )
    ).toBeNull();
  });
  it('rejects traversal and malformed slugs before loading', () => {
    const posts = fixture();
    posts.pl.translationGroup = {
      ...group,
      slugs: { ...group.slugs, de: '../outside' },
    };
    expect(
      resolveBlogTranslationGroup(posts.pl, () => {
        throw new Error('must not load');
      })
    ).toBeNull();
    expect(getPostBySlug('../outside', 'pl')).toBeNull();
  });
});
