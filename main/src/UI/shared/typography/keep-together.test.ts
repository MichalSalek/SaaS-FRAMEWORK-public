import { describe, expect, it } from 'vitest';
import { splitUnbreakablePieces } from './keep-together';

const kept = (text: string) =>
  splitUnbreakablePieces(text)
    .filter(piece => piece.keep)
    .map(piece => piece.text);
const joined = (text: string) =>
  splitUnbreakablePieces(text)
    .map(piece => piece.text)
    .join('');

describe('splitUnbreakablePieces', () => {
  it('keeps a number with its unit', () => {
    expect(kept('Pro możesz sprawdzić przez 30 dni.')).toEqual(['30 dni']);
    expect(kept('Plan od 79 zł miesięcznie, 0% prowizji')).toEqual([
      '79 zł',
      '0%',
    ]);
  });

  it('keeps a hint in parentheses', () => {
    expect(kept('Cisza nocna (21:00 bis 9:00 UTC) gilt immer.')).toEqual([
      '(21:00 bis 9:00 UTC)',
    ]);
  });

  it('keeps a short head with the word after its hyphen', () => {
    expect(kept('Link per E-Mail, dann den QR-Code zeigen')).toEqual([
      'E-Mail',
      'QR-Code',
    ]);
  });

  it('leaves a long compound alone', () => {
    expect(kept('Gellack-Maniküre im Editorial-Stil')).toEqual([]);
  });

  it('never loses or reorders text', () => {
    for (const text of [
      'Zwykłe zdanie bez niczego.',
      'E-Mail (Pflichtfeld) und 30 Tage Test für 19 EUR',
      '',
    ]) {
      expect(joined(text)).toBe(text);
    }
  });
});
