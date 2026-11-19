import { describe, expect, it } from 'vitest';
import { keepHyphenatedTogether, keepShortWordsWithNext } from './short-words';

const NBSP = ' ';

describe('keepShortWordsWithNext', () => {
  it('glues a one-letter word to the word after it', () => {
    expect(keepShortWordsWithNext('Zdjęcia w galerii i na profilu')).toBe(
      `Zdjęcia w${NBSP}galerii i${NBSP}na profilu`
    );
  });

  it('handles two short words in a row and a capital at the start', () => {
    expect(keepShortWordsWithNext('W tej sekcji a w razie potrzeby')).toBe(
      `W${NBSP}tej sekcji a${NBSP}w${NBSP}razie potrzeby`
    );
  });

  it('sees a short word behind an opening quote or parenthesis', () => {
    expect(keepShortWordsWithNext('sekcja („w galerii”) (i dalej)')).toBe(
      `sekcja („w${NBSP}galerii”) (i${NBSP}dalej)`
    );
  });

  it('leaves text without short words, and longer words, alone', () => {
    expect(keepShortWordsWithNext('Dodaj zdjęcie stylizacji')).toBe(
      'Dodaj zdjęcie stylizacji'
    );
    expect(keepShortWordsWithNext('do na we ze')).toBe('do na we ze');
    expect(keepShortWordsWithNext('Kompletność')).toBe('Kompletność');
  });

  it('does not touch a trailing short word or doubled spaces', () => {
    expect(keepShortWordsWithNext('plan i')).toBe('plan i');
    expect(keepShortWordsWithNext('plan i  cena')).toBe('plan i  cena');
  });
});

describe('keepHyphenatedTogether', () => {
  const WJ = '\u2060';

  it('forbids the break after a hyphen between letters', () => {
    expect(keepHyphenatedTogether('E-Mail-Versand, Logs')).toBe(
      `E-${WJ}Mail-${WJ}Versand, Logs`
    );
  });

  it('leaves a dash between spaces and a minus before a digit alone', () => {
    expect(keepHyphenatedTogether('Plan - 5 dni, saldo -3')).toBe(
      'Plan - 5 dni, saldo -3'
    );
  });
});
