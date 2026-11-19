import { describe, it, expect } from 'vitest';
import { stripInlineMarkup } from './strip-inline-markup';

describe('stripInlineMarkup', () => {
  it('removes paired pseudo-tags, keeping inner text', () => {
    expect(
      stripInlineMarkup(
        'Różne narzędzia. <compareLink>Zobacz pełne porównanie.</compareLink>'
      )
    ).toBe('Różne narzędzia. Zobacz pełne porównanie.');
  });

  it('removes multiple / nested-looking tags in one string', () => {
    expect(
      stripInlineMarkup(
        'Systemy to <strong>99 PLN</strong> lub <price>PLN</price>'
      )
    ).toBe('Systemy to 99 PLN lub PLN');
  });

  it('removes self-closing tags', () => {
    expect(stripInlineMarkup('Napisz do nas <email/> teraz')).toBe(
      'Napisz do nas  teraz'
    );
  });

  it('preserves a bare "<" that does not form a tag', () => {
    expect(stripInlineMarkup('cena < 50 PLN')).toBe('cena < 50 PLN');
  });

  it('leaves plain strings (no markup) unchanged', () => {
    expect(stripInlineMarkup('Darmowy plan masz na zawsze.')).toBe(
      'Darmowy plan masz na zawsze.'
    );
  });

  it('leaves ICU placeholders intact while stripping surrounding tags', () => {
    expect(stripInlineMarkup('<strong>{days}</strong> left')).toBe(
      '{days} left'
    );
  });
});
