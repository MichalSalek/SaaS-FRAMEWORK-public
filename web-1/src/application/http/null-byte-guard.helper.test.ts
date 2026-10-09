import { describe, expect, it } from 'vitest';
import { containsNullByte } from './null-byte-guard.helper';

const NUL = String.fromCharCode(0);

describe('containsNullByte', () => {
  it("detects NUL inside a string ('a' + U+0000 + 'b')", () => {
    expect(containsNullByte('a' + NUL + 'b')).toBe(true);
  });

  it('walks nested objects and arrays', () => {
    expect(containsNullByte({ a: { b: ['x', 'a' + NUL + 'b'] } })).toBe(true);
    expect(containsNullByte(['ok', { nest: NUL }])).toBe(true);
  });

  it('returns false for non-strings and clean trees', () => {
    expect(containsNullByte(1)).toBe(false);
    expect(containsNullByte(true)).toBe(false);
    expect(containsNullByte(null)).toBe(false);
    expect(containsNullByte(undefined)).toBe(false);
    expect(containsNullByte({ a: 1, b: false })).toBe(false);
    expect(containsNullByte(['a', 2])).toBe(false);
    expect(containsNullByte('ab')).toBe(false);
  });

  it('na granicy glebokosci (64) odrzuca zamiast przepuszczac', () => {
    // Regresja: granica zwracala `false` („czysto"), wiec ladunek zagniezdzony
    // ponizej progu przechodzil obok bramki — `{"a":{"a":{…65x…}}}` parsuje sie
    // normalnie, a uzasadnienie „JSON to drzewo acykliczne" nie ogranicza
    // glebokosci. Nierozpoznane = odrzucone.
    let tooDeep: unknown = { n: 'a' + NUL + 'b' };
    for (let i = 0; i < 64; i += 1) {
      tooDeep = { n: tooDeep };
    }
    expect(containsNullByte(tooDeep)).toBe(true);

    // Rowniez czyste, ale za glebokie cialo jest odrzucane — swiadomy koszt:
    // takiego ksztaltu to API nie przyjmuje w zadnym legalnym scenariuszu.
    let deepAndClean: unknown = { n: 'ok' };
    for (let i = 0; i < 64; i += 1) {
      deepAndClean = { n: deepAndClean };
    }
    expect(containsNullByte(deepAndClean)).toBe(true);

    let inBound: unknown = { n: 'a' + NUL + 'b' };
    for (let i = 0; i < 63; i += 1) {
      inBound = { n: inBound };
    }
    expect(containsNullByte(inBound)).toBe(true);
  });
});
