import { z } from 'zod';
import { wireInstant } from '../../application/contracts/wire-values';
import { VALIDATION_MESSAGES } from '../i18n/validation.i18n';
import {
  SupportSenderTypeValue,
  SupportThreadCategoryValue,
  SupportThreadStatusValue,
  type SupportThreadCategory,
  type SupportThreadStatus,
} from '../../models/db_models.generated.dto';
import { SUPPORT_LENGTHS } from '../../policies/validation.config';
import {
  parsePgSafeDate,
  validateByMinLength,
} from '../../policies/validation/validation.utils';

const V = VALIDATION_MESSAGES;

/**
 * Threads created before categories existed. Not a column value. Lives here so the generated DTO
 * file can re-export it without the contract importing that file.
 */
export const SUPPORT_CATEGORY_FILTER_NONE = 'NONE' as const;
export type SupportThreadCategoryFilter =
  SupportThreadCategory | typeof SUPPORT_CATEGORY_FILTER_NONE;

export const supportStatusValues: readonly SupportThreadStatus[] =
  Object.values(SupportThreadStatusValue);

export const supportCategoryFilterValues: readonly SupportThreadCategoryFilter[] =
  [...Object.values(SupportThreadCategoryValue), SUPPORT_CATEGORY_FILTER_NONE];

// Free-text field with the EXACT else-if cascade of the hand-written validator: exactly ONE i18n
// key per field (zodValidate concatenates issues per path, so one superRefine with early returns
// keeps that). Blank/MIN are the TRIMMED length; MAX is the RAW length.
const freeTextField = (
  min: number,
  max: number,
  keys: { required: string; tooShort: string; tooLong: string }
) =>
  z.string({ error: keys.required }).superRefine((value, ctx) => {
    const trimmed = value.trim();
    if (!validateByMinLength(trimmed, 1)) {
      ctx.addIssue({ code: 'custom', message: keys.required });
      return;
    }
    if (!validateByMinLength(trimmed, min)) {
      ctx.addIssue({ code: 'custom', message: keys.tooShort });
      return;
    }
    if (value.length > max) {
      ctx.addIssue({ code: 'custom', message: keys.tooLong });
    }
  });

const threadId = z
  .string({ error: V.support.threadIdRequired })
  .min(1, V.support.threadIdRequired);

const messageText = freeTextField(
  SUPPORT_LENGTHS.MESSAGE_MIN,
  SUPPORT_LENGTHS.MESSAGE_MAX,
  {
    required: V.support.messageRequired,
    tooShort: V.support.messageTooShort,
    tooLong: V.support.messageTooLong,
  }
);

const contentText = (max: number) =>
  freeTextField(SUPPORT_LENGTHS.MESSAGE_MIN, max, {
    required: V.support.contentRequired,
    tooShort: V.support.contentTooShort,
    tooLong: V.support.contentTooLong,
  });

export const createSupportThreadSchema = z.object({
  category: z.enum(SupportThreadCategoryValue, {
    error: V.support.categoryRequired,
  }),
  message: messageText,
});

export const addSupportMessageSchema = z.object({
  thread_id: threadId,
  content: contentText(SUPPORT_LENGTHS.MESSAGE_MAX),
});

export const adminSupportReplySchema = z.object({
  thread_id: threadId,
  content: contentText(SUPPORT_LENGTHS.REPLY_MAX),
});

export const markSupportThreadReadSchema = z.object({
  thread_id: threadId,
});

/**
 * Body shape of the unused kernel validator for GET thread messages. The live route reads
 * `thread_id` from the query string and answers `{ thread_id: 'Required' }` when it is missing;
 * this schema stays so that validator's characterization tests keep their i18n keys.
 */
export const supportThreadIdBody = z.object({
  thread_id: threadId,
});

export const changeSupportStatusSchema = z.object({
  thread_id: threadId,
  status: z.enum(SupportThreadStatusValue, { error: V.support.statusInvalid }),
  // Present-only. null and undefined are an unconditional change. A bad token is its own field
  // error even when a sibling field is also invalid (field-level refine, not object-level).
  expected_updated_at: z
    .union([z.string(), z.date(), z.null()], { error: V.support.statusInvalid })
    .optional()
    .superRefine((raw, ctx) => {
      if (raw === undefined || raw === null) {
        return;
      }
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

const category = z.enum(SupportThreadCategoryValue).nullable();
const status = z.enum(SupportThreadStatusValue);
const sender = z.enum(SupportSenderTypeValue).nullable();

export const supportMessageSchema = z.object({
  id: z.string(),
  thread_id: z.string(),
  sender_type: z.enum(SupportSenderTypeValue),
  content: z.string(),
  created_at: wireInstant,
});

const threadListBase = {
  id: z.string(),
  subject: z.string(),
  category,
  status,
  created_at: wireInstant,
  updated_at: wireInstant,
  last_message_preview: z.string().nullable(),
  last_message_sender_type: sender,
  message_count: z.number(),
};

export const userThreadPageSchema = z.object({
  threads: z.array(
    z.object({ ...threadListBase, has_unread_reply: z.boolean() })
  ),
  nextCursor: z.string().nullable(),
});

export const adminThreadPageSchema = z.object({
  threads: z.array(
    z.object({
      ...threadListBase,
      user_email: z.string(),
      user_name: z.string(),
    })
  ),
  nextCursor: z.string().nullable(),
});

export const userThreadMessagesSchema = z.object({
  messages: z.array(supportMessageSchema),
  thread: z.object({
    id: z.string(),
    subject: z.string(),
    category,
    status,
  }),
});

export const adminThreadMessagesSchema = z.object({
  messages: z.array(supportMessageSchema),
  thread: z.object({
    id: z.string(),
    subject: z.string(),
    category,
    status,
    updated_at: wireInstant,
    user_email: z.string(),
    user_name: z.string(),
  }),
});

export const threadIdSchema = z.object({ thread_id: z.string() });
export const unreadCountSchema = z.object({ unread_threads: z.number() });
export const messageIdSchema = z.object({ message_id: z.string() });
export const statusChangedSchema = z.object({
  thread_id: z.string(),
  status,
});
