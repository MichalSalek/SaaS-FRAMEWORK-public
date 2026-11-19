import { describe, it, expect } from 'vitest';
import {
  pickFreeVanity,
  pickVanityBase,
  slugifyVanityBase,
} from './vanity-url.auto';

describe('slugifyVanityBase', () => {
  it('transliterates Polish and German letters', () => {
    expect(slugifyVanityBase('Łucja Żółć-Wąs')).toBe('lucja-zolc-was');
    expect(slugifyVanityBase('Jürgen Großmann')).toBe('jurgen-grossmann');
  });

  it('collapses punctuation and trims hyphens', () => {
    expect(slugifyVanityBase('  Anna K. • Nails!! ')).toBe('anna-k-nails');
  });

  it('returns null when fewer than 3 usable characters remain', () => {
    expect(slugifyVanityBase('💅✨')).toBeNull();
    expect(slugifyVanityBase('Jo')).toBeNull();
    expect(slugifyVanityBase(null)).toBeNull();
    expect(slugifyVanityBase('')).toBeNull();
  });

  it('keeps room for a collision suffix and never ends with a hyphen', () => {
    const slug = slugifyVanityBase(`${'a'.repeat(44)} b`);
    expect(slug).toBe('a'.repeat(44));
    expect((slugifyVanityBase('x'.repeat(80)) ?? '').length).toBe(45);
  });
});

describe('pickFreeVanity', () => {
  const tail = (): string => '4321';

  it('takes the base when free', () => {
    expect(pickFreeVanity('anna', new Set(), tail)).toBe('anna');
  });

  it('numbers collisions from 2', () => {
    expect(pickFreeVanity('anna', new Set(['anna', 'anna-2']), tail)).toBe(
      'anna-3'
    );
  });

  it('skips reserved words', () => {
    expect(pickFreeVanity('admin', new Set(), tail)).toBe('admin-2');
  });

  it('falls back to a random tail when 2..9 are taken', () => {
    const taken = new Set([
      'anna',
      ...[2, 3, 4, 5, 6, 7, 8, 9].map(n => `anna-${n}`),
    ]);
    expect(pickFreeVanity('anna', taken, tail)).toBe('anna-4321');
  });
});

describe('pickVanityBase', () => {
  it('prefers the Instagram handle over the display name', () => {
    expect(pickVanityBase(['anna.nails_waw', 'Anna Kowalska'])).toBe(
      'anna-nails-waw'
    );
  });

  it('falls back to the display name when the handle is missing or unusable', () => {
    expect(pickVanityBase([null, 'Anna Kowalska'])).toBe('anna-kowalska');
    expect(pickVanityBase(['__', 'Anna Kowalska'])).toBe('anna-kowalska');
    expect(pickVanityBase([undefined, null])).toBeNull();
  });
});
