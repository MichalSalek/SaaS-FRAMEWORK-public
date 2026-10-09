import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import type { PUBLIC_DTO_API_V1 } from '../../models/public/public.dto';
import {
  VALIDATION_LENGTHS,
  VALIDATION_PAGINATION,
} from '../validation.config';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

const V = VALIDATION_MESSAGES;

// getPublicStylistsList: every field is optional partial-validation — the hand-written
// validator only checked a field when `!== undefined` (optional chaining + guard), so each
// schema field is `.optional()` with the same i18n key per branch the original emitted.
const getPublicStylistsListSchema = z.object({
  // cursor: optional; non-string OR empty string → invalidCursor (single key for both branches).
  cursor: z
    .string({ error: V.pagination.invalidCursor })
    .min(1, V.pagination.invalidCursor)
    .optional(),
  // take: optional; non-number OR < LIMIT_MIN OR > LIMIT_MAX_BROWSE → invalidLimit (single key).
  take: z
    .number({ error: V.pagination.invalidLimit })
    .min(VALIDATION_PAGINATION.LIMIT_MIN, V.pagination.invalidLimit)
    .max(VALIDATION_PAGINATION.LIMIT_MAX_BROWSE, V.pagination.invalidLimit)
    .optional(),
  // city: optional; non-string → invalidType; string > CITY_FILTER_MAX → cityTooLong.
  city: z
    .string({ error: V.search.invalidType })
    .max(VALIDATION_LENGTHS.CITY_FILTER_MAX, V.search.cityTooLong)
    .optional(),
  // searchQuery: optional; non-string → invalidType; string > SEARCH_QUERY_MAX → queryTooLong.
  searchQuery: z
    .string({ error: V.search.invalidType })
    .max(VALIDATION_LENGTHS.SEARCH_QUERY_MAX, V.search.queryTooLong)
    .optional(),
});

export const publicValidators = {
  getPublicStylistsList: (data: unknown) =>
    zodValidate(getPublicStylistsListSchema, data),
} as const;

// ── Compile-time REQUEST-DTO ↔ schema binding (drift stops compilation) ──
// One exported witness type per domain; each property fails to compile if the schema's
// inferred output drifts from its REQUEST DTO. Exported so it is never flagged unused.
export type PublicRequestSchemaBindings = {
  getPublicStylistsList: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof getPublicStylistsListSchema>,
      PUBLIC_DTO_API_V1['GET_PUBLIC_STYLISTS_LIST']['REQUEST']
    >
  >;
};
