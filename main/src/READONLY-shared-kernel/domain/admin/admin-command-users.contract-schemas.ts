import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../i18n/validation.i18n';
import { REPORT_PERIODS, TIMELINE_EVENT_TYPES } from './admin.config';
import {
  LOG_APPLICATIONS,
  LOG_ENVIRONMENTS,
  LOG_ISSUE_NOTE_MAX_LENGTH,
  LOG_ISSUE_STATUSES,
  LOG_STREAM_MAX_TAKE,
} from './log-triage.config';
import { SEND_LOG_TYPES } from './send-log.config';
import { PricingPlanValue } from '../pricing/pricing.config';
import { MODERATION_ACTIONS } from '../../models/moderation/moderation.dto';
import {
  VALIDATION_BULK,
  VALIDATION_LENGTHS,
  VALIDATION_MODERATION,
  VALIDATION_PAGINATION,
} from '../../policies/validation.config';

const V = VALIDATION_MESSAGES;

// ── Users (admin keys only; disable/enable/session stay in the validator) ───

// One message, the original else-if order: required, then too many, then a bad element.
const bulkUserIdsField = z.custom<string[]>().superRefine((val, ctx) => {
  if (!Array.isArray(val) || val.length === 0) {
    ctx.addIssue({ code: 'custom', message: V.bulk.userIdsRequired });
  } else if (val.length > VALIDATION_BULK.MAX_USER_IDS) {
    ctx.addIssue({ code: 'custom', message: V.bulk.userIdsTooMany });
  } else if (
    val.some((id: unknown) => typeof id !== 'string' || id.length === 0)
  ) {
    ctx.addIssue({ code: 'custom', message: V.bulk.userIdsInvalid });
  }
});

const pricingPlanEnumElseIf = z.enum(PricingPlanValue, {
  error: issue => {
    const hasInput = Boolean(issue.input);
    return hasInput ? V.payment.invalidPlan : V.payment.missingPlan;
  },
});

// A falsy plan used to accumulate both keys. The joined string matches that slot.
const pricingPlanEnumSequential = z.enum(PricingPlanValue, {
  error: issue => {
    const hasInput = Boolean(issue.input);
    return hasInput
      ? V.payment.invalidPlan
      : `${V.payment.missingPlan} ${V.payment.invalidPlan}`;
  },
});

export const purgeDeletedUserSchema = z.object({
  user_id: z.string({ error: V.user.noIdentifier }),
});

export const adminBecomeUserSchema = z.object({
  id: z.string({ error: V.user.invalidId }).min(1, V.user.invalidId),
});

export const adminChangePricingPlanSchema = z.object({
  id: z.string({ error: V.user.invalidId }).min(1, V.user.invalidId),
  pricing_plan: pricingPlanEnumSequential,
});

export const adminBulkDisableSchema = z.object({ user_ids: bulkUserIdsField });
export const adminBulkEnableSchema = z.object({ user_ids: bulkUserIdsField });
export const adminBulkLogoutSchema = z.object({ user_ids: bulkUserIdsField });

export const adminBulkChangePlanSchema = z.object({
  user_ids: bulkUserIdsField,
  pricing_plan: pricingPlanEnumElseIf,
});

// ── Moderation (admin). Gallery report stays in moderation.validation.ts ────

const actionEnum = z.enum(MODERATION_ACTIONS, {
  error: issue =>
    typeof issue.input === 'string' && issue.input.length > 0
      ? V.moderation.actionInvalid
      : V.moderation.actionRequired,
});

// null means absent. The inner optional accepts the coerced undefined.
const optionalCappedText = (maxLen: number, key: string) =>
  z
    .preprocess(
      v => (v === null ? undefined : v),
      z.string({ error: key }).max(maxLen, key).optional()
    )
    .optional();

export const adminResolveReportSchema = z.object({
  report_id: z
    .string({ error: V.moderation.reportIdRequired })
    .min(1, V.moderation.reportIdRequired),
  action: actionEnum,
  admin_note: optionalCappedText(
    VALIDATION_MODERATION.ADMIN_NOTE_MAX,
    V.moderation.adminNoteTooLong
  ),
});

export const adminApplyStrikeSchema = z.object({
  user_id: z
    .string({ error: V.moderation.userIdRequired })
    .min(1, V.moderation.userIdRequired),
  reason: z
    .string({ error: V.moderation.strikeReasonRequired })
    .min(1, V.moderation.strikeReasonRequired)
    .max(
      VALIDATION_MODERATION.STRIKE_REASON_MAX,
      V.moderation.strikeReasonTooLong
    ),
  report_id: z.string({ error: V.moderation.reportIdInvalid }).optional(),
});

// ── Logs: send + the GET validators (routes stay lenient; these are the 400s
//    the validator unit tests still call) ─────────────────────────────────────

// DECISION: every field error goes to `__general` (routeIssuesToGeneral on the validator).
// user_id becomes a string or null. A non-string client_url is dropped. Unknown keys are stripped.
export const sendLogSchema = z.object({
  environment: z
    .string({ error: V.sendLog.environmentRequired })
    .min(1, V.sendLog.environmentRequired)
    .max(VALIDATION_LENGTHS.LOG_ENVIRONMENT_MAX, V.sendLog.environmentRequired),
  namespace: z
    .string({ error: V.sendLog.namespaceRequired })
    .min(1, V.sendLog.namespaceRequired)
    .max(VALIDATION_LENGTHS.LOG_NAMESPACE_MAX, V.sendLog.namespaceRequired),
  type: z
    .string({ error: V.sendLog.typeRequired })
    .refine(
      value => (SEND_LOG_TYPES as readonly string[]).includes(value),
      V.sendLog.typeRequired
    ),
  message: z
    .string({ error: V.sendLog.messageRequired })
    .min(1, V.sendLog.messageRequired)
    .max(VALIDATION_LENGTHS.LOG_MESSAGE_MAX, V.sendLog.messageRequired),
  payload: z
    .string({ error: V.sendLog.payloadRequired })
    .max(VALIDATION_LENGTHS.LOG_PAYLOAD_MAX, V.sendLog.payloadRequired),
  user_id: z
    .unknown()
    .optional()
    .transform(value =>
      typeof value === 'string' && value.length > 0 ? value : null
    ),
  user_metadata: z
    .string({ error: V.sendLog.userMetadataRequired })
    .max(
      VALIDATION_LENGTHS.LOG_USER_METADATA_MAX,
      V.sendLog.userMetadataRequired
    ),
  client_url: z.string().optional().catch(undefined),
});

// DECISION: runtime is looser than the DTO (null page/limit/event_type means absent).
// Permissive fields plus superRefine keep the i18n keys and check every field even when
// user_id is bad. The binding schema below is the typed witness, not the parser.
export const getUserTimelineRuntimeSchema = z
  .object({
    user_id: z.unknown().optional(),
    page: z.unknown().optional(),
    limit: z.unknown().optional(),
    event_type: z.unknown().optional(),
  })
  .superRefine((d, ctx) => {
    if (typeof d.user_id !== 'string' || d.user_id.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['user_id'],
        message: V.user.invalidId,
      });
    }
    if (d.page !== undefined && d.page !== null) {
      if (typeof d.page !== 'number') {
        ctx.addIssue({
          code: 'custom',
          path: ['page'],
          message: V.timeline.pageMustBeNumber,
        });
      } else if (
        d.page < VALIDATION_PAGINATION.PAGE_MIN ||
        !Number.isInteger(d.page)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['page'],
          message: V.timeline.pageMinOne,
        });
      }
    }
    if (d.limit !== undefined && d.limit !== null) {
      if (typeof d.limit !== 'number') {
        ctx.addIssue({
          code: 'custom',
          path: ['limit'],
          message: V.timeline.limitMustBeNumber,
        });
      } else if (
        d.limit < VALIDATION_PAGINATION.LIMIT_MIN ||
        d.limit > VALIDATION_PAGINATION.LIMIT_MAX ||
        !Number.isInteger(d.limit)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['limit'],
          message: V.timeline.limitRange,
        });
      }
    }
    if (d.event_type !== undefined && d.event_type !== null) {
      if (typeof d.event_type !== 'string') {
        ctx.addIssue({
          code: 'custom',
          path: ['event_type'],
          message: V.timeline.eventTypeMustBeString,
        });
      } else if (
        !(TIMELINE_EVENT_TYPES as readonly string[]).includes(d.event_type)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['event_type'],
          message: V.timeline.eventTypeInvalid,
        });
      }
    }
  });

export const getUserTimelineBindingSchema = z.object({
  user_id: z.string(),
  page: z.number().optional(),
  limit: z.number().optional(),
  event_type: z.enum(TIMELINE_EVENT_TYPES).optional(),
});

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const getLogsSchema = z.object({
  environment: z
    .enum(LOG_ENVIRONMENTS, { error: V.getLogs.environmentMustBeString })
    .optional(),
  application: z
    .enum(LOG_APPLICATIONS, { error: V.getLogs.applicationInvalid })
    .optional(),
  type: z.enum(SEND_LOG_TYPES, { error: V.getLogs.typeInvalid }).optional(),
  search: z
    .string({ error: V.getLogs.searchInvalid })
    .max(200, { error: V.getLogs.searchTooLong })
    .optional(),
  date_from: z
    .string({ error: V.getLogs.dateInvalid })
    .regex(ISO_DAY, { error: V.getLogs.dateInvalid })
    .optional(),
  date_to: z
    .string({ error: V.getLogs.dateInvalid })
    .regex(ISO_DAY, { error: V.getLogs.dateInvalid })
    .optional(),
  hide_startup_noise: z
    .boolean({ error: V.getLogs.hideStartupNoiseInvalid })
    .optional(),
  cursor: z
    .number({ error: V.getLogs.cursorInvalid })
    .int({ error: V.getLogs.cursorInvalid })
    .positive({ error: V.getLogs.cursorInvalid })
    .optional(),
  take: z
    .number({ error: V.getLogs.takeInvalid })
    .int({ error: V.getLogs.takeInvalid })
    .min(1, { error: V.getLogs.takeInvalid })
    .max(LOG_STREAM_MAX_TAKE, { error: V.getLogs.takeInvalid })
    .optional(),
});

export const getLogDetailsSchema = z.object({
  id: z
    .number({ error: V.getLogDetails.idInvalid })
    .int({ error: V.getLogDetails.idInvalid })
    .positive({ error: V.getLogDetails.idInvalid }),
});

export const getLogGroupsSchema = getLogsSchema
  .pick({
    environment: true,
    application: true,
    type: true,
  })
  .extend({
    attention: z.boolean({ error: V.getLogs.attentionInvalid }).optional(),
  });

export const setLogIssueStatusSchema = z.object({
  fingerprint: z
    .string({ error: V.logIssueStatus.fingerprintRequired })
    .regex(/^[0-9a-f]{32}$/, { error: V.logIssueStatus.fingerprintRequired }),
  status: z.enum(LOG_ISSUE_STATUSES, {
    error: V.logIssueStatus.statusInvalid,
  }),
  note: z
    .string({ error: V.logIssueStatus.noteMustBeString })
    .max(LOG_ISSUE_NOTE_MAX_LENGTH, { error: V.logIssueStatus.noteTooLong })
    .optional(),
});

// Reports period validator (the route falls back; this schema is the 400 the tests call).
const periodEnum = z.enum(REPORT_PERIODS, {
  error: issue => {
    const hasInput = Boolean(issue.input);
    return hasInput ? V.report.periodInvalid : V.report.periodRequired;
  },
});

export const adminGetReportsSchema = z.object({
  period: periodEnum,
});
