import { describe, expect, it } from 'vitest';
import {
  NOTE_EXCERPT_MAX,
  noteExcerpt,
  shouldOfferNoteAsBio,
} from './notes-presentation';

describe('noteExcerpt', () => {
  it('folds line breaks and keeps a short note whole', () => {
    expect(noteExcerpt('Lubi pastele.\n\nUczulenie na akryl.')).toBe(
      'Lubi pastele. Uczulenie na akryl.'
    );
  });

  it('cuts a long note at a word boundary with an ellipsis', () => {
    const long = 'słowo '.repeat(60);
    const excerpt = noteExcerpt(long);
    expect(excerpt.length).toBeLessThanOrEqual(NOTE_EXCERPT_MAX + 1);
    expect(excerpt.endsWith('słowo…')).toBe(true);
  });
});

describe('shouldOfferNoteAsBio', () => {
  it('offers only a non-empty note while the profile text is empty and unanswered', () => {
    expect(
      shouldOfferNoteAsBio({
        generalNote: 'Pierwsze paznokcie zrobiłam w wieku 14 lat',
        description: null,
        answered: false,
      })
    ).toBe(true);
    expect(
      shouldOfferNoteAsBio({
        generalNote: 'x',
        description: 'Mam opis',
        answered: false,
      })
    ).toBe(false);
    expect(
      shouldOfferNoteAsBio({
        generalNote: '  ',
        description: null,
        answered: false,
      })
    ).toBe(false);
    expect(
      shouldOfferNoteAsBio({
        generalNote: 'x',
        description: '',
        answered: true,
      })
    ).toBe(false);
  });
});
