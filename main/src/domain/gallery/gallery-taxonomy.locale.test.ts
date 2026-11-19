import { describe, expect, it } from 'vitest';
import {
  COLOR_SEED_DATA,
  TRAIT_SEED_DATA,
} from '@kernel/domain/gallery/gallery.seed';
import { getLocalizedTaxonomyName } from './gallery-taxonomy.locale';

describe('global gallery taxonomy display names', () => {
  it('covers every seeded color and trait in all supported locales', () => {
    for (const { name } of [...COLOR_SEED_DATA, ...TRAIT_SEED_DATA]) {
      expect(getLocalizedTaxonomyName(name, 'pl')).toBe(name);
      for (const locale of ['en', 'de']) {
        const result = getLocalizedTaxonomyName(name, locale);
        expect(result.length).toBeGreaterThan(0);
        if (!['French', 'Ombre', 'Baby Boomer', 'Marble'].includes(name)) {
          expect(result).not.toBe(name);
        }
      }
    }
  });
  it('translates existing database names without changing ids or stored names', () => {
    expect(getLocalizedTaxonomyName('Jednolite', 'en')).toBe('Solid color');
    expect(getLocalizedTaxonomyName('Minimalistyczne', 'de')).toBe(
      'Minimalistisch'
    );
    expect(getLocalizedTaxonomyName('Wzorki', 'de')).toBe('Muster');
  });
  it('preserves unknown and custom names and falls back to Polish', () => {
    expect(getLocalizedTaxonomyName('Custom label', 'de')).toBe('Custom label');
    expect(getLocalizedTaxonomyName('Jednolite', 'fr')).toBe('Jednolite');
  });
});
