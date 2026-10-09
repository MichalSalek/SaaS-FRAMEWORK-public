import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import type { SUPPORT_DTO_API_V1 } from '../../models/support/support.dto';
import {
  SupportThreadCategoryValue,
  SupportThreadStatusValue,
} from '../../models/support/support.dto';
import { SUPPORT_LENGTHS } from '../validation.config';
import { validateByMinLength, parsePgSafeDate } from './validation.utils';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

const V = VALIDATION_MESSAGES;

// Free-text field schema with the EXACT else-if cascade of the hand-written validator:
// exactly ONE i18n key is emitted per field per failure (zodValidate concatenates issues
// per path, so a single `.superRefine` with early-returns preserves the one-message-per-
// field semantics the originals had).
//
// DECISION (nie usuwaj tego komentarza):
// Blank/MIN floory liczone na TRIMOWANEJ wartosci przez validateByMinLength (reuzycie
// security-helpera, nie reimplementacja), MAX na SUROWEJ dlugosci (raw `.length`) —
// parytet 1:1 z oryginalem (test "too long, raw length" to pinuje). Kolejnosc cascade:
// required (brak/non-string) -> blank (trim<1) -> tooShort (trim<MIN) -> tooLong (raw>MAX).
const freeTextField = (
  min: number,
  max: number,
  keys: {
    required: string;
    tooShort: string;
    tooLong: string;
  }
) =>
  z.string({ error: keys.required }).superRefine((value, ctx) => {
    const trimmed = value.trim();
    if (!validateByMinLength(trimmed, 1)) {
      // blank / whitespace-only -> Required (parytet z `.trim().length < 1`)
      ctx.addIssue({ code: 'custom', message: keys.required });
      return;
    }
    if (!validateByMinLength(trimmed, min)) {
      ctx.addIssue({ code: 'custom', message: keys.tooShort });
      return;
    }
    if (value.length > max) {
      ctx.addIssue({ code: 'custom', message: keys.tooLong });
      return;
    }
  });

// DECISION (nie usuwaj tego komentarza):
// The request carries a CATEGORY, not a subject (S126). The server derives the
// thread title out of the first message (backend support-subject.resolver.ts),
// so SUPPORT_LENGTHS.SUBJECT_* are no longer input limits; they bound the
// derived title. Missing (non-string) and non-member (incl. '', wrong case) both map
// to `categoryRequired`: in the form both mean "nothing valid was picked".
const createSupportThreadSchema = z.object({
  category: z.enum(SupportThreadCategoryValue, {
    error: V.support.categoryRequired,
  }),
  message: freeTextField(
    SUPPORT_LENGTHS.MESSAGE_MIN,
    SUPPORT_LENGTHS.MESSAGE_MAX,
    {
      required: V.support.messageRequired,
      tooShort: V.support.messageTooShort,
      tooLong: V.support.messageTooLong,
    }
  ),
});

const addSupportMessageSchema = z.object({
  thread_id: z
    .string({ error: V.support.threadIdRequired })
    .min(1, V.support.threadIdRequired),
  content: freeTextField(
    SUPPORT_LENGTHS.MESSAGE_MIN,
    SUPPORT_LENGTHS.MESSAGE_MAX,
    {
      required: V.support.contentRequired,
      tooShort: V.support.contentTooShort,
      tooLong: V.support.contentTooLong,
    }
  ),
});

const adminSupportReplySchema = z.object({
  thread_id: z
    .string({ error: V.support.threadIdRequired })
    .min(1, V.support.threadIdRequired),
  content: freeTextField(
    SUPPORT_LENGTHS.MESSAGE_MIN,
    SUPPORT_LENGTHS.REPLY_MAX,
    {
      required: V.support.contentRequired,
      tooShort: V.support.contentTooShort,
      tooLong: V.support.contentTooLong,
    }
  ),
});

const getSupportThreadMessagesSchema = z.object({
  thread_id: z
    .string({ error: V.support.threadIdRequired })
    .min(1, V.support.threadIdRequired),
});

const markSupportThreadReadSchema = z.object({
  thread_id: z
    .string({ error: V.support.threadIdRequired })
    .min(1, V.support.threadIdRequired),
});

const changeSupportStatusSchema = z.object({
  thread_id: z
    .string({ error: V.support.threadIdRequired })
    .min(1, V.support.threadIdRequired),
  // Enum over the Prisma-generated const object → z.infer = SupportThreadStatus union
  // (binds to the DTO). Missing (non-string) AND non-member (incl. '', wrong case) both
  // map to `statusInvalid` — the original used the same key for missing and invalid.
  status: z.enum(SupportThreadStatusValue, { error: V.support.statusInvalid }),
  // Optimistic-concurrency token — OPTIONAL. Typed union (string | Date | null) binds to
  // the DTO; the union-level error gives `statusInvalid` for a wrongly-typed value (number).
  //
  // DECISION (nie usuwaj tego komentarza):
  // Parse-validity (empty string / unparseable / Invalid Date) is checked in a FIELD-LEVEL
  // `.superRefine` (NOT object-level) so it runs INDEPENDENTLY of thread_id/status — a bad
  // thread_id/status must not suppress the expected_updated_at error. The hand-written
  // validator checked each field in sequence (no early return); an object-level superRefine
  // is skipped whenever the base object parse fails on a sibling, dropping this error.
  expected_updated_at: z
    .union([z.string(), z.date(), z.null()], { error: V.support.statusInvalid })
    .optional()
    .superRefine((raw, ctx) => {
      // present-only: undefined/null => absent => unconditional status change (not an error).
      if (raw === undefined || raw === null) {
        return;
      }
      // Zakres PostgreSQL, nie tylko parsowalność (patrz DECISION przy
      // `parsePgSafeDate`): data spoza zakresu kończyła się 500 z warstwy bazy.
      const isValidDate = raw instanceof Date && parsePgSafeDate(raw) !== null;
      const isValidIso =
        typeof raw === 'string' &&
        raw.length > 0 &&
        parsePgSafeDate(raw) !== null;
      if (!isValidDate && !isValidIso) {
        ctx.addIssue({ code: 'custom', message: V.support.statusInvalid });
      }
    }),
});

export const supportValidators = {
  createSupportThread: (data: unknown) =>
    zodValidate(createSupportThreadSchema, data),
  addSupportMessage: (data: unknown) =>
    zodValidate(addSupportMessageSchema, data),
  adminSupportReply: (data: unknown) =>
    zodValidate(adminSupportReplySchema, data),
  getSupportThreadMessages: (data: unknown) =>
    zodValidate(getSupportThreadMessagesSchema, data),
  markSupportThreadRead: (data: unknown) =>
    zodValidate(markSupportThreadReadSchema, data),
  changeSupportStatus: (data: unknown) =>
    zodValidate(changeSupportStatusSchema, data),
} as const;

// ── Compile-time REQUEST-DTO ↔ schema binding (drift stops compilation) ──
// One exported witness type per domain; each property fails to compile if the schema's
// inferred output drifts from its REQUEST DTO. Exported so it is never flagged unused.
export type SupportRequestSchemaBindings = {
  createSupportThread: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof createSupportThreadSchema>,
      SUPPORT_DTO_API_V1['SUPPORT_CREATE_THREAD']['REQUEST']
    >
  >;
  addSupportMessage: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof addSupportMessageSchema>,
      SUPPORT_DTO_API_V1['SUPPORT_ADD_MESSAGE']['REQUEST']
    >
  >;
  adminSupportReply: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminSupportReplySchema>,
      SUPPORT_DTO_API_V1['SUPPORT_ADMIN_REPLY']['REQUEST']
    >
  >;
  getSupportThreadMessages: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof getSupportThreadMessagesSchema>,
      SUPPORT_DTO_API_V1['SUPPORT_GET_THREAD_MESSAGES']['REQUEST']
    >
  >;
  markSupportThreadRead: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof markSupportThreadReadSchema>,
      SUPPORT_DTO_API_V1['SUPPORT_MARK_THREAD_READ']['REQUEST']
    >
  >;
  changeSupportStatus: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof changeSupportStatusSchema>,
      SUPPORT_DTO_API_V1['SUPPORT_CHANGE_STATUS']['REQUEST']
    >
  >;
};
