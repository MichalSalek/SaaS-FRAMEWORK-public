import { describe, it, expect } from 'vitest';
import {
  isHelpSearchActive,
  matchesHelpQuery,
} from './HelpCenterSearch.helpers';

describe('matchesHelpQuery', () => {
  it('matches everything for an empty or whitespace query', () => {
    expect(matchesHelpQuery('', 'cokolwiek')).toBe(true);
    expect(matchesHelpQuery('   ', 'cokolwiek')).toBe(true);
  });

  it('finds an inflected Polish phrase from a chip label', () => {
    expect(
      matchesHelpQuery(
        'Sesja inspiracji',
        'Jak działa sesja?',
        'Klientka wysyła sesji inspiracji zdjęcia.'
      )
    ).toBe(true);
    expect(matchesHelpQuery('Galeria', 'Co widać w galerii stylistki?')).toBe(
      true
    );
  });

  it('ignores case and Polish or German diacritics', () => {
    expect(matchesHelpQuery('zdjecie', 'Jak dodać ZDJĘCIE?')).toBe(true);
    expect(matchesHelpQuery('Łatwo', 'to jest latwe')).toBe(true);
    expect(matchesHelpQuery('strasse', 'Die Straße')).toBe(true);
  });

  it('requires every word of the query', () => {
    expect(matchesHelpQuery('kod platnosc', 'Kod QR w salonie')).toBe(false);
    expect(matchesHelpQuery('kod QR', 'Pokaż kod QR klientce')).toBe(true);
  });

  it('keeps short words whole', () => {
    expect(matchesHelpQuery('QR', 'kod qr')).toBe(true);
    expect(matchesHelpQuery('kot', 'kod qr')).toBe(false);
  });

  it('treats a query without letters or digits as no search', () => {
    expect(isHelpSearchActive('')).toBe(false);
    expect(isHelpSearchActive('  ?! - ')).toBe(false);
    expect(isHelpSearchActive(' QR ')).toBe(true);
  });
});
