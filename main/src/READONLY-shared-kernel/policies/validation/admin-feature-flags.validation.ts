import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import type { ADMIN_DTO_API_V1 } from '../../models/admin/admin.dto';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

const V = VALIDATION_MESSAGES;

// DECISION (nie usuwaj tego komentarza):
// key walidowany tylko jako niepusty string, NIE przeciw FEATURE_FLAG_KEYS SSOT.
// Świadome: nieznany key jest obsłużony graceful na poziomie operacji
// (adminToggleFeatureFlag_IO findUnique → brak rekordu → failure
// ADMIN_TARGET_NOT_FOUND → 404), więc zachowanie JEST poprawne. Membership-check
// vs FEATURE_FLAG_KEYS wymagałby NOWEGO klucza komunikatu i18n (brak generycznego
// "unknown value" pasującego semantycznie) → coupling z {pl,en,de}/common.json
// i ryzyko i18n-coverage FAIL. NIE re-flaguj braku membership-check jako bug.
//
// Wierny port ręcznego walidatora: oryginał odrzucał `key` gdy
// `!typedData?.key || typeof typedData.key !== 'string'` (falsy — w tym '' — lub
// nie-string) z kluczem invalidKey; `min(1)` z tym samym kluczem odwzorowuje
// odrzucenie pustego stringa (zarówno type-mismatch jak i '' emitują invalidKey,
// więc komunikat jest identyczny niezależnie od gałęzi zod).
const adminToggleFeatureFlagSchema = z.object({
  key: z
    .string({ error: V.featureFlag.invalidKey })
    .min(1, V.featureFlag.invalidKey),
  is_enabled: z.boolean({ error: V.featureFlag.invalidEnabled }),
});

export const adminFeatureFlagsValidators = {
  adminToggleFeatureFlag: (data: unknown) =>
    zodValidate(adminToggleFeatureFlagSchema, data),
} as const;

// ── Compile-time REQUEST-DTO ↔ schema binding (drift stops compilation) ──
// One exported witness type per domain; each property fails to compile if the schema's
// inferred output drifts from its REQUEST DTO. Exported so it is never flagged unused.
export type AdminFeatureFlagsRequestSchemaBindings = {
  adminToggleFeatureFlag: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminToggleFeatureFlagSchema>,
      ADMIN_DTO_API_V1['ADMIN_TOGGLE_FEATURE_FLAG']['REQUEST']
    >
  >;
};
