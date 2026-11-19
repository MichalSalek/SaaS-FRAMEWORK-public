import { z } from 'zod';
import { EMAIL_CATEGORY } from './email-schedule.config';
import type { FREE_EMAIL_CONFIG, FREE_EMAIL_RULES } from './email-free.config';
import type { CancelEmailRule, TrialEmailRule } from './email-schedule.types';

type EmailScheduleResponse = {
  schedule: readonly TrialEmailRule[];
  cancelSchedule: readonly CancelEmailRule[];
  freeSchedule: {
    config: typeof FREE_EMAIL_CONFIG;
    rules: typeof FREE_EMAIL_RULES;
  };
};

const category = z.enum(EMAIL_CATEGORY);

const trialRule = z
  .object({
    id: z.string(),
    triggerDay: z.number(),
    triggerAnchor: z.enum(['trial_start', 'trial_end']),
    triggerOffsetDays: z.number(),
    condition: z.enum(['ACTIVE', 'INACTIVE', 'ANY']),
    category,
    infoEvent: z.string(),
    subjectKey: z.string(),
    bodyTemplateId: z.string(),
    framing: z.string(),
    personalizeWith: z.array(z.string()).readonly(),
  })
  .readonly();

const cancelRule = z
  .object({
    id: z.string(),
    triggerDay: z.number(),
    category,
    infoEvent: z.string(),
    bodyTemplateId: z.string(),
  })
  .readonly();

const freeRule = z.object({
  infoEvent: z.string(),
  category,
  subjectKey: z.string(),
  targetAction: z.string(),
});

export const emailScheduleResponseSchema = z.object({
  schedule: z.array(trialRule).readonly(),
  cancelSchedule: z.array(cancelRule).readonly(),
  freeSchedule: z.object({
    config: z.object({
      CAMPAIGN_ID: z.string(),
      VERSION: z.string(),
      CONTENT_VERSION: z.string(),
      OPPORTUNITIES: z
        .array(z.object({ id: z.string(), day: z.number() }))
        .readonly(),
      WINDOW_HOURS: z.number(),
      MIN_GAP_HOURS: z.number(),
      NEW_EXPIRY_DAYS: z.number(),
      EXISTING_SPREAD_DAYS: z.number(),
      EXISTING_EXPIRY_DAYS: z.number(),
    }),
    // The object schema checks the wire shape. The asserted output is the config type the
    // operation returns, so a readonly schedule stays assignable to the handler.
    rules: z.object({
      'free-first-photo': freeRule,
      'free-public-profile': freeRule,
      'free-first-client': freeRule,
    }),
  }),
}) as unknown as z.ZodType<EmailScheduleResponse>;

export const emailPreferencesResponseSchema = z.object({
  preferences: z.object({
    trial_sequence: z.boolean(),
    marketing: z.boolean(),
  }),
});

const lifecycleContext = z.object({
  accountId: z.string(),
  messageId: z.string(),
  entryId: z.string(),
  ctaId: z.string(),
  enteredAt: z.string(),
  family: z.string(),
  ruleId: z.string(),
  templateId: z.string(),
  locale: z.string(),
  cohort: z.string(),
  provider: z.string().nullable(),
});

export const emailLifecycleEntryResponseSchema = z.object({
  attribution: lifecycleContext.nullable(),
});

export const emailLifecycleActionsResponseSchema = z.object({
  actions: z.array(
    z.object({
      id: z.string(),
      accountId: z.string(),
      occurredAt: z.string(),
      attribution: lifecycleContext.nullable(),
    })
  ),
  nextCursor: z.string().nullable(),
});

export const emailHistoryResponseSchema = z.object({
  emails: z.array(
    z.object({
      event_log_id: z.string(),
      event: z.string(),
      sentAt: z.string(),
      category: z.union([category, z.literal('UNKNOWN')]),
    })
  ),
  nextCursor: z.string().nullable(),
});
