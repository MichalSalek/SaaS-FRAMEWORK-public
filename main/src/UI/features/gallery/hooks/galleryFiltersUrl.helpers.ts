// UI/features/gallery/hooks/galleryFiltersUrl.helpers.ts
// URL contract of the gallery filters (own gallery and a stylist's gallery):
// `?colors=<id>,<id>&traits=<id>&length=LONG&exact=1`. Pure parse/build pair
// for `useUrlSyncedState`; defaults never reach the address.

import {
  NAIL_LENGTHS,
  type NailLength,
} from '@kernel/domain/gallery/nail-length.config';
import type { UrlStateCodec } from '../../../shared/hooks/useUrlSyncedState';
import type { GalleryFiltersState } from '../../shared/gallery/hooks/useGalleryFiltersState';

type QueryRecord = Record<string, string | string[] | undefined>;

const KEY_COLORS = 'colors';
const KEY_TRAITS = 'traits';
const KEY_LENGTH = 'length';
const KEY_EXACT = 'exact';

/** A hand-edited address must not turn into hundreds of filter chips. */
const MAX_IDS = 30;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// A Set, not an object lookup: `length=toString` must not resolve to an
// inherited Object.prototype member.
const NAIL_LENGTH_VALUES = new Set<string>(Object.values(NAIL_LENGTHS));

const isNailLength = (value: string): value is NailLength =>
  NAIL_LENGTH_VALUES.has(value);

const first = (raw: string | string[] | undefined): string | undefined =>
  Array.isArray(raw) ? raw[0] : raw;

const parseIds = (raw: string | string[] | undefined): string[] => {
  const value = first(raw);
  if (value === undefined || value === '') {
    return [];
  }
  const ids = value.split(',').filter(id => ID_PATTERN.test(id));
  return Array.from(new Set(ids)).slice(0, MAX_IDS);
};

export const parseGalleryFiltersQuery = (
  query: QueryRecord
): GalleryFiltersState => {
  const length = first(query[KEY_LENGTH]);
  return {
    selectedColors: parseIds(query[KEY_COLORS]),
    selectedTraits: parseIds(query[KEY_TRAITS]),
    selectedLength:
      length !== undefined && isNailLength(length) ? length : null,
    exactMatch: first(query[KEY_EXACT]) === '1',
  };
};

export const buildGalleryFiltersQuery = (
  state: GalleryFiltersState
): Record<string, string> => {
  const query: Record<string, string> = {};
  if (state.selectedColors.length > 0) {
    query[KEY_COLORS] = state.selectedColors.join(',');
  }
  if (state.selectedTraits.length > 0) {
    query[KEY_TRAITS] = state.selectedTraits.join(',');
  }
  if (state.selectedLength !== null) {
    query[KEY_LENGTH] = state.selectedLength;
  }
  if (state.exactMatch) {
    query[KEY_EXACT] = '1';
  }
  return query;
};

export const GALLERY_FILTERS_URL_CODEC: UrlStateCodec<GalleryFiltersState> = {
  keys: [KEY_COLORS, KEY_TRAITS, KEY_LENGTH, KEY_EXACT],
  parse: parseGalleryFiltersQuery,
  build: buildGalleryFiltersQuery,
};
