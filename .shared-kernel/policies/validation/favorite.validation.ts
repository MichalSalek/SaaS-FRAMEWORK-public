import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import type { FAVORITE_DTO_API_V1 } from '../../models/favorites/favorite.dto';
import { VALIDATION_LENGTHS } from '../validation.config';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

const V = VALIDATION_MESSAGES;

// Shared `note` field schema: optional, nullable, capped at NOTE_MAX.
// Original guard: `note !== null && note !== undefined` → then typeof !== 'string'
// → invalidNote, else length > NOTE_MAX → noteTooLong. `.nullable().optional()`
// reproduces "null and undefined are accepted (no-op)"; the type-error key is
// invalidNote (non-string present value), `.max` carries noteTooLong. Empty string
// '' is a length-0 string → passes (matches the CHARACTERIZATION test).
const optionalNote = z
  .string({ error: V.favorite.invalidNote })
  .max(VALIDATION_LENGTHS.NOTE_MAX, V.favorite.noteTooLong)
  .nullable()
  .optional();

const bookmarkStylistSchema = z.object({
  stylist_account_id: z
    .string({ error: V.favorite.invalidStylistId })
    .min(1, V.favorite.invalidStylistId),
});

const unbookmarkStylistSchema = z.object({
  stylist_account_id: z
    .string({ error: V.favorite.invalidStylistId })
    .min(1, V.favorite.invalidStylistId),
});

const favoriteAddRecordSchema = z.object({
  gallery_record_id: z
    .string({ error: V.favorite.invalidRecordId })
    .min(1, V.favorite.invalidRecordId),
  note: optionalNote,
});

const favoriteRemoveRecordSchema = z.object({
  gallery_record_id: z
    .string({ error: V.favorite.invalidRecordId })
    .min(1, V.favorite.invalidRecordId),
});

// DECISION (nie usuwaj tego komentarza):
// `note` w UPDATE_RECORD_NOTE REQUEST DTO jest WYMAGANY (`note: string | null`), ale ręczny
// walidator (i pinujący go test charakteryzacyjny: `note: undefined` → __isValid:true) AKCEPTUJE
// brak `note` — guard `note !== null && note !== undefined` cicho przepuszczał undefined. To
// JEDYNY drift schema↔DTO w tym pliku: zod musi użyć `.optional()` by zachować to zachowanie
// bit-w-bit (siatka testów zielona), więc `z.infer` daje `note?: string | null`, a DTO obiecuje
// `note: string | null` (required). Binding poniżej rozluźnia DOKŁADNIE ten jeden klucz
// (`note?:`) — `gallery_record_id` zostaje twardo związany (drift tam nadal blokuje build).
const favoriteUpdateRecordNoteSchema = z.object({
  gallery_record_id: z
    .string({ error: V.favorite.invalidRecordId })
    .min(1, V.favorite.invalidRecordId),
  note: optionalNote,
});

export const favoriteValidators = {
  bookmarkStylist: (data: unknown) => zodValidate(bookmarkStylistSchema, data),
  unbookmarkStylist: (data: unknown) =>
    zodValidate(unbookmarkStylistSchema, data),
  // always-valid passthrough — GET (cursor/take) bez body-walidacji w oryginale;
  // brak czego walidować → brak witness (REQUEST DTO opcjonalny `{cursor?,take?}|undefined`).
  getBookmarkedStylists: (_data: unknown) => ({
    __isValid: true,
    __general: '',
  }),
  favoriteAddRecord: (data: unknown) =>
    zodValidate(favoriteAddRecordSchema, data),
  favoriteRemoveRecord: (data: unknown) =>
    zodValidate(favoriteRemoveRecordSchema, data),
  // always-valid passthrough — GET (cursor/take) bez body-walidacji w oryginale.
  favoriteGetRecords: (_data: unknown) => ({ __isValid: true, __general: '' }),
  favoriteUpdateRecordNote: (data: unknown) =>
    zodValidate(favoriteUpdateRecordNoteSchema, data),
  // always-valid passthrough — REQUEST DTO = undefined (brak body do walidacji).
  favoriteGetGrouped: (_data: unknown) => ({ __isValid: true, __general: '' }),
} as const;

// ── Compile-time REQUEST-DTO ↔ schema binding (drift stops compilation) ──
// One exported witness type per domain; each property fails to compile if the schema's
// inferred output drifts from its REQUEST DTO. Exported so it is never flagged unused.
// Passthrough validators (getBookmarkedStylists / favoriteGetRecords / favoriteGetGrouped)
// have no witness: there is no schema to bind (always-valid, nothing to validate).
//
// `UpdateNoteDtoNoteOptional` relaxes the single documented `note`-optionality drift (see
// DECISION above) while keeping `gallery_record_id` strictly bound.
type UpdateNoteDtoNoteOptional = Omit<
  FAVORITE_DTO_API_V1['FAVORITE_UPDATE_RECORD_NOTE']['REQUEST'],
  'note'
> & {
  note?: FAVORITE_DTO_API_V1['FAVORITE_UPDATE_RECORD_NOTE']['REQUEST']['note'];
};

export type FavoriteRequestSchemaBindings = {
  bookmarkStylist: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof bookmarkStylistSchema>,
      FAVORITE_DTO_API_V1['BOOKMARK_STYLIST']['REQUEST']
    >
  >;
  unbookmarkStylist: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof unbookmarkStylistSchema>,
      FAVORITE_DTO_API_V1['UNBOOKMARK_STYLIST']['REQUEST']
    >
  >;
  favoriteAddRecord: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof favoriteAddRecordSchema>,
      FAVORITE_DTO_API_V1['FAVORITE_ADD_RECORD']['REQUEST']
    >
  >;
  favoriteRemoveRecord: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof favoriteRemoveRecordSchema>,
      FAVORITE_DTO_API_V1['FAVORITE_REMOVE_RECORD']['REQUEST']
    >
  >;
  favoriteUpdateRecordNote: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof favoriteUpdateRecordNoteSchema>,
      UpdateNoteDtoNoteOptional
    >
  >;
};
