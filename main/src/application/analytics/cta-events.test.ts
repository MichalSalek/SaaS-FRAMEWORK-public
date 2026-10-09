import { describe, it, expect } from 'vitest';
import { resolvePageKind } from './cta-events';

describe('resolvePageKind', () => {
  it('mapuje ścieżki polskie (domyślny język, bez prefiksu)', () => {
    expect(resolvePageKind('/')).toBe('home');
    expect(resolvePageKind('/for-stylists')).toBe('stylists');
    expect(resolvePageKind('/for-studios')).toBe('studios');
    expect(resolvePageKind('/pricing')).toBe('pricing');
    expect(resolvePageKind('/blog/jakis-wpis')).toBe('blog');
    expect(resolvePageKind('/help-center')).toBe('help');
  });

  it('zdejmuje prefiks języka — inaczej cały ruch nie-polski wpada w „other"', () => {
    expect(resolvePageKind('/en/pricing')).toBe('pricing');
    expect(resolvePageKind('/de/blog/irgendein-beitrag')).toBe('blog');
    expect(resolvePageKind('/en')).toBe('home');
    expect(resolvePageKind('/de')).toBe('home');
  });

  it('nie myli prefiksu języka z podobnie zaczynającą się ścieżką', () => {
    // '/end-of-something' zaczyna się od 'en', ale nie jest prefiksem języka.
    expect(resolvePageKind('/end-of-something')).toBe('other');
  });

  it('nieznana ścieżka to „other", nie zgadywanie', () => {
    expect(resolvePageKind('/app/home')).toBe('other');
    expect(resolvePageKind('/terms')).toBe('other');
  });
});
