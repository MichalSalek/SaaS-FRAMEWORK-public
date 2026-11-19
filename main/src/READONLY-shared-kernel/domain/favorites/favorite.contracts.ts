import { z } from 'zod';
import { defineContracts } from '../../application/contracts/contract.types';
import { QUERY_FIELD } from '../../application/contracts/query-fields';
import { VALIDATION_MESSAGES } from '../i18n/validation.i18n';
import { VALIDATION_LENGTHS } from '../../policies/validation.config';
import { TRAIT_CATEGORIES } from '../admin/traits.config';

/**
 * Favorites endpoints (client side: saved stylists and liked gallery works).
 * SSOT for route, method, request, response, events, grants and limiter tier; see the DECISION in
 * `application/contracts/contract.types.ts`. Every operation here is client-only: the handlers also
 * call `requireClientAccount`, and a stylist is refused by RBAC first (403, FAV-RBAC-GROUPED-1).
 */

const V = VALIDATION_MESSAGES.favorite;

const stylistAccountId = z
  .string({ error: V.invalidStylistId })
  .min(1, V.invalidStylistId);

const galleryRecordId = z
  .string({ error: V.invalidRecordId })
  .min(1, V.invalidRecordId);

// Optional, nullable note capped at NOTE_MAX: null and undefined are accepted, a non-string present
// value is invalidNote, an over-long one noteTooLong, '' is a valid empty note.
const optionalNote = z
  .string({ error: V.invalidNote })
  .max(VALIDATION_LENGTHS.NOTE_MAX, V.noteTooLong)
  .nullable()
  .optional();

const successFlag = z.object({ success: z.boolean() });

const pageQuery = {
  cursor: QUERY_FIELD.string(),
  take: QUERY_FIELD.int(50),
};

export const FAVORITE_CONTRACTS = defineContracts({
  /** The client saves a stylist (returns the created bookmark). */
  BOOKMARK_STYLIST: {
    summary:
      'Klientka dodaje stylistkę do zapisanych (zwraca id utworzonego wpisu).',
    group: 'FAVORITE',
    kind: 'COMMAND',
    path: 'bookmark/bookmark-stylist',
    method: 'POST',
    body: z.object({ stylist_account_id: stylistAccountId }),
    query: null,
    response: z.object({
      id: z.string(),
      client_user_id: z.string(),
      stylist_account_id: z.string(),
    }),
    successEvents: ['STYLIST_BOOKMARK_ADDED'],
    auditEvents: ['STYLIST_BOOKMARKED'],
    access: 'CLIENT',
    authCheck: true,
    limiterTier: 'default',
  },

  /** The client removes a saved stylist (not saved = 200 STYLIST_NOT_BOOKMARKED). */
  UNBOOKMARK_STYLIST: {
    summary: 'Klientka usuwa stylistkę z zapisanych.',
    group: 'FAVORITE',
    kind: 'COMMAND',
    path: 'bookmark/unbookmark-stylist',
    method: 'POST',
    body: z.object({ stylist_account_id: stylistAccountId }),
    query: null,
    response: successFlag,
    successEvents: ['STYLIST_UNBOOKMARKED', 'STYLIST_NOT_BOOKMARKED'],
    auditEvents: ['STYLIST_UNBOOKMARKED', 'STYLIST_NOT_BOOKMARKED'],
    access: 'CLIENT',
    authCheck: true,
    limiterTier: 'default',
  },

  /** Paginated saved stylists (name, city, number of works, paired flag). */
  GET_BOOKMARKED_STYLISTS: {
    summary:
      'Stronicowana lista zapisanych stylistek klientki (nazwa, miasto, liczba prac, flaga sparowania).',
    group: 'FAVORITE',
    kind: 'QUERY',
    path: 'bookmark/get-bookmarked',
    method: 'GET',
    body: null,
    query: pageQuery,
    response: z.object({
      records: z.array(
        z.object({
          id: z.string(),
          stylist_account_id: z.string(),
          business_name: z.string().nullable(),
          address_city: z.string().nullable(),
          display_name: z.string().nullable(),
          gallery_count: z.number(),
          is_paired: z.boolean(),
          bookmarked_at: z.string(),
        })
      ),
      nextCursor: z.string().nullable(),
    }),
    successEvents: ['BOOKMARKED_STYLISTS_FETCHED'],
    auditEvents: [],
    access: 'CLIENT',
    authCheck: true,
    limiterTier: 'default',
  },

  /** The client likes one gallery work (optional note). */
  FAVORITE_ADD_RECORD: {
    summary:
      'Klientka zapisuje pojedynczą pracę z galerii do ulubionych (opcjonalna notatka).',
    group: 'FAVORITE',
    kind: 'COMMAND',
    path: 'favorite/add-record',
    method: 'POST',
    body: z.object({ gallery_record_id: galleryRecordId, note: optionalNote }),
    query: null,
    response: z.object({
      id: z.string(),
      client_user_id: z.string(),
      gallery_record_id: z.string(),
      note: z.string().nullable(),
    }),
    successEvents: ['FAVORITE_RECORD_ADDED'],
    auditEvents: ['FAVORITE_RECORD_ADDED'],
    access: 'CLIENT',
    authCheck: true,
    limiterTier: 'default',
  },

  /**
   * The client removes a like. Removing a work that is not liked returns 200 with
   * RECORD_NOT_IN_FAVORITES (DECISION in the handler).
   * Test: web-1/src/test-utils/integration/favorite-remove-record.test.ts (covers the not-liked 200
   * leaving other clients' likes alone; not concurrent removals).
   */
  FAVORITE_REMOVE_RECORD: {
    summary: 'Klientka usuwa pracę z galerii z ulubionych.',
    group: 'FAVORITE',
    kind: 'COMMAND',
    path: 'favorite/remove-record',
    method: 'POST',
    body: z.object({ gallery_record_id: galleryRecordId }),
    query: null,
    response: successFlag,
    successEvents: ['RECORD_REMOVED_FROM_FAVORITES', 'RECORD_NOT_IN_FAVORITES'],
    auditEvents: ['RECORD_REMOVED_FROM_FAVORITES', 'RECORD_NOT_IN_FAVORITES'],
    access: 'CLIENT',
    authCheck: true,
    limiterTier: 'default',
  },

  /** Paginated liked works with details (colours, traits, stylist, note). */
  FAVORITE_GET_RECORDS: {
    summary:
      'Stronicowana płaska lista ulubionych prac z detalami (kolory, cechy, stylistka, notatka).',
    group: 'FAVORITE',
    kind: 'QUERY',
    path: 'favorite/get-records',
    method: 'GET',
    body: null,
    query: pageQuery,
    response: z.object({
      records: z.array(
        z.object({
          id: z.string(),
          gallery_record_id: z.string(),
          asset_url: z.string(),
          colors: z.array(
            z.object({ id: z.string(), name: z.string(), hex_code: z.string() })
          ),
          traits: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              category: z.enum(TRAIT_CATEGORIES),
              icon_url: z.string().nullable(),
              is_featured: z.boolean(),
            })
          ),
          stylist_account_id: z.string(),
          stylist_display_name: z.string().nullable(),
          note: z.string().nullable(),
        })
      ),
      nextCursor: z.string().nullable(),
    }),
    successEvents: ['FAVORITE_RECORDS_FETCHED'],
    auditEvents: [],
    access: 'CLIENT',
    authCheck: true,
    limiterTier: 'default',
  },

  /**
   * Updates the client's note on a liked work. A missing `note` clears it: the schema defaults it
   * to null, so the handler always receives `note: string | null`.
   */
  FAVORITE_UPDATE_RECORD_NOTE: {
    summary: 'Aktualizuje notatkę klientki przy ulubionej pracy z galerii.',
    group: 'FAVORITE',
    kind: 'COMMAND',
    path: 'favorite/update-record-note',
    method: 'POST',
    body: z.object({
      gallery_record_id: galleryRecordId,
      note: optionalNote.transform(note => note ?? null),
    }),
    query: null,
    response: z.object({
      gallery_record_id: z.string(),
      note: z.string().nullable(),
    }),
    successEvents: ['FAVORITE_RECORD_NOTE_UPDATED'],
    auditEvents: ['FAVORITE_RECORD_NOTE_UPDATED'],
    access: 'CLIENT',
    authCheck: true,
    limiterTier: 'default',
  },

  /** Liked works grouped by stylist (count and a few latest thumbnails). */
  FAVORITE_GET_GROUPED: {
    summary:
      'Ulubione prace pogrupowane po stylistce (liczba i kilka ostatnich miniatur).',
    group: 'FAVORITE',
    kind: 'QUERY',
    path: 'favorite/get-grouped',
    method: 'GET',
    body: null,
    query: null,
    response: z.object({
      groups: z.array(
        z.object({
          stylist_account_id: z.string(),
          stylist_display_name: z.string().nullable(),
          stylist_profile_image_url: z.string().nullable(),
          favorites_count: z.number(),
          recent_favorites: z.array(
            z.object({
              favorite_id: z.string(),
              gallery_record_id: z.string(),
              image_url: z.string(),
              created_at: z.string(),
            })
          ),
        })
      ),
    }),
    successEvents: ['FAVORITE_GROUPED_FETCHED'],
    auditEvents: [],
    access: 'CLIENT',
    authCheck: true,
    limiterTier: 'default',
  },
});

export type FavoriteContracts = typeof FAVORITE_CONTRACTS;
