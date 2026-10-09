import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import type { MODERATION_DTO_API_V1 } from '../../models/moderation/moderation.dto';
import {
  CONTENT_REPORT_REASONS,
  MODERATION_ACTIONS,
} from '../../models/moderation/moderation.dto';
import { VALIDATION_MODERATION } from '../validation.config';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

const V = VALIDATION_MESSAGES;

// reason / action: the original distinguishes "missing" (falsy OR non-string) from
// "invalid value" (truthy non-empty string not in the SSOT allowlist). Faithful port of:
//   if (!value || typeof !== 'string')   → <field>Required   (undefined/null/'' /non-string)
//   else if (!ALLOWLIST.includes(value)) → <field>Invalid    (non-empty string not a member)
// Same shape as gallery's nailLengthCreate: a string with length > 0 → invalid; everything
// else (empty string, non-string, null/undefined) → required/missing. z.enum infers the
// literal union (= ContentReportReason / ModerationAction DTO) so the binding stays exact.
const reasonEnum = z.enum(CONTENT_REPORT_REASONS, {
  error: issue =>
    typeof issue.input === 'string' && issue.input.length > 0
      ? V.moderation.reasonInvalid
      : V.moderation.reasonRequired,
});

const actionEnum = z.enum(MODERATION_ACTIONS, {
  error: issue =>
    typeof issue.input === 'string' && issue.input.length > 0
      ? V.moderation.actionInvalid
      : V.moderation.actionRequired,
});

// Optional free-text field where the original validates ONLY when `!== undefined && !== null`
// (so null is treated as "absent" → accepted), and otherwise rejects non-string / over-max
// under a single i18n key. DTO type is `?: string` (no null), so the schema must infer
// `string | undefined` to bind.
//
// `z.preprocess` maps null → undefined BEFORE the inner check; the INNER `.optional()` then
// accepts that undefined (so a coerced-null short-circuits as "absent"), while the OUTER
// `.optional()` makes the object KEY itself optional. Both `.optional()` are required:
// `.optional()` on a pipe only short-circuits on `undefined` and does NOT run preprocess first,
// so without the inner one a literal null would fall through to `z.string()` and be rejected.
// (Empty string passes: only the MAX bound is enforced — the *_MIN config is NOT applied,
// exactly like the hand-written validator.)
const optionalCappedText = (maxLen: number, key: string) =>
  z
    .preprocess(
      v => (v === null ? undefined : v),
      z.string({ error: key }).max(maxLen, key).optional()
    )
    .optional();

const reportGalleryRecordSchema = z.object({
  gallery_record_id: z
    .string({ error: V.moderation.galleryRecordIdRequired })
    .min(1, V.moderation.galleryRecordIdRequired),
  reason: reasonEnum,
  description: optionalCappedText(
    VALIDATION_MODERATION.DESCRIPTION_MAX,
    V.moderation.descriptionTooLong
  ),
});

const adminResolveReportSchema = z.object({
  report_id: z
    .string({ error: V.moderation.reportIdRequired })
    .min(1, V.moderation.reportIdRequired),
  action: actionEnum,
  admin_note: optionalCappedText(
    VALIDATION_MODERATION.ADMIN_NOTE_MAX,
    V.moderation.adminNoteTooLong
  ),
});

const adminApplyStrikeSchema = z.object({
  user_id: z
    .string({ error: V.moderation.userIdRequired })
    .min(1, V.moderation.userIdRequired),
  // reason: falsy | non-string → strikeReasonRequired; else length > MAX → strikeReasonTooLong.
  reason: z
    .string({ error: V.moderation.strikeReasonRequired })
    .min(1, V.moderation.strikeReasonRequired)
    .max(
      VALIDATION_MODERATION.STRIKE_REASON_MAX,
      V.moderation.strikeReasonTooLong
    ),
  // report_id: optional, but ASYMMETRIC vs description/admin_note — the original guard is
  // `report_id !== undefined && typeof !== 'string'` (NO null short-circuit, NO max). So:
  //   undefined → accepted; non-string (incl. null) → reportIdInvalid; '' → accepted (a string).
  // Plain `.optional()` reproduces this 1:1 (null is rejected as a non-string, '' passes,
  // no length bound). Characterization test pins the null-rejected / empty-string-accepted asymmetry.
  report_id: z.string({ error: V.moderation.reportIdInvalid }).optional(),
});

export const moderationValidators = {
  reportGalleryRecord: (data: unknown) =>
    zodValidate(reportGalleryRecordSchema, data),
  adminResolveReport: (data: unknown) =>
    zodValidate(adminResolveReportSchema, data),
  adminApplyStrike: (data: unknown) =>
    zodValidate(adminApplyStrikeSchema, data),
} as const;

// ── Compile-time REQUEST-DTO ↔ schema binding (drift stops compilation) ──
// One exported witness type per domain; each property fails to compile if the schema's
// inferred output drifts from its REQUEST DTO. Exported so it is never flagged unused.
export type ModerationRequestSchemaBindings = {
  reportGalleryRecord: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof reportGalleryRecordSchema>,
      MODERATION_DTO_API_V1['REPORT_GALLERY_RECORD']['REQUEST']
    >
  >;
  adminResolveReport: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminResolveReportSchema>,
      MODERATION_DTO_API_V1['ADMIN_RESOLVE_REPORT']['REQUEST']
    >
  >;
  adminApplyStrike: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminApplyStrikeSchema>,
      MODERATION_DTO_API_V1['ADMIN_APPLY_STRIKE']['REQUEST']
    >
  >;
};
