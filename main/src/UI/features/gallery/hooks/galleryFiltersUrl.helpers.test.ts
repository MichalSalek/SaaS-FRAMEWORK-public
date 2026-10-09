import { describe, expect, it } from 'vitest';
import {
  buildGalleryFiltersQuery,
  parseGalleryFiltersQuery,
} from './galleryFiltersUrl.helpers';

describe('gallery filters URL codec', () => {
  it('keeps a clean address for the default state', () => {
    expect(
      buildGalleryFiltersQuery({
        selectedColors: [],
        selectedTraits: [],
        selectedLength: null,
        exactMatch: false,
      })
    ).toEqual({});
  });

  it('round-trips a full selection', () => {
    const state = {
      selectedColors: ['c1', 'c2'],
      selectedTraits: ['t1'],
      selectedLength: 'LONG' as const,
      exactMatch: true,
    };
    expect(parseGalleryFiltersQuery(buildGalleryFiltersQuery(state))).toEqual(
      state
    );
  });

  it('drops malformed ids, duplicates and unknown lengths', () => {
    expect(
      parseGalleryFiltersQuery({
        colors: 'c1,,c1,<script>,c2',
        traits: ['t1,t2', 'ignored'],
        length: 'toString',
        exact: 'yes',
      })
    ).toEqual({
      selectedColors: ['c1', 'c2'],
      selectedTraits: ['t1', 't2'],
      selectedLength: null,
      exactMatch: false,
    });
  });

  it('caps the number of ids read from a hand-edited address', () => {
    const many = Array.from({ length: 80 }, (_, i) => `id${i}`).join(',');
    expect(
      parseGalleryFiltersQuery({ colors: many }).selectedColors
    ).toHaveLength(30);
  });
});
