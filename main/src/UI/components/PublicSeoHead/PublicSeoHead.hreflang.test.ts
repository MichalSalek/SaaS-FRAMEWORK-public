import { describe, expect, it } from 'vitest';
import { resolveHreflangAlternates } from './PublicSeoHead.composition';

const D = 'https://nailfolio.app';

describe('resolveHreflangAlternates', () => {
  it('translated page: all three locales, x-default = PL (unchanged behaviour)', () => {
    const r = resolveHreflangAlternates(D, '/pricing/', ['pl', 'en', 'de']);
    expect(r.alternates).toEqual([
      { code: 'pl', href: `${D}/pricing/` },
      { code: 'en', href: `${D}/en/pricing/` },
      { code: 'de', href: `${D}/de/pricing/` },
    ]);
    expect(r.xDefaultUrl).toBe(`${D}/pricing/`);
  });

  it('Polish-only blog post: no /en/ or /de/ promise (they return 404)', () => {
    const r = resolveHreflangAlternates(
      D,
      '/blog/jak-stworzyc-portfolio-paznokci/',
      ['pl']
    );
    expect(r.alternates).toEqual([
      { code: 'pl', href: `${D}/blog/jak-stworzyc-portfolio-paznokci/` },
    ]);
    expect(
      r.alternates.some(a => a.href.includes('/en/') || a.href.includes('/de/'))
    ).toBe(false);
    expect(r.xDefaultUrl).toBe(`${D}/blog/jak-stworzyc-portfolio-paznokci/`);
  });

  it('page without a PL variant: x-default falls back to the first available locale', () => {
    const r = resolveHreflangAlternates(D, '/blog/some-english-post/', ['en']);
    expect(r.alternates).toEqual([
      { code: 'en', href: `${D}/en/blog/some-english-post/` },
    ]);
    expect(r.xDefaultUrl).toBe(`${D}/en/blog/some-english-post/`);
  });

  it('keeps the kernel locale order regardless of the input order', () => {
    const r = resolveHreflangAlternates(D, '/', ['de', 'pl']);
    expect(r.alternates.map(a => a.code)).toEqual(['pl', 'de']);
  });
});
