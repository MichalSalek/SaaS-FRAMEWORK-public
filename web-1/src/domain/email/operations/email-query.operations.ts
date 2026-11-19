import {
  FREE_EMAIL_CONFIG,
  FREE_EMAIL_RULES,
} from '@kernel/domain/email/email-free.config';
/**
 * Email Query Operations
 *
 * SRP: Admin-facing read operations for email lifecycle.
 */

import {
  type OperationResult,
  success,
  failure,
} from '@kernel/application/result.types';
import type {
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import { isValidCursorFormat } from '@kernel/policies/validation/validation.utils';
import {
  TRIAL_EMAIL_SCHEDULE,
  CANCEL_EMAIL_SCHEDULE,
  DUNNING_EMAIL_SCHEDULE,
  ONBOARDING_ABANDONMENT_RULE,
  RENEWAL_REMINDER_RULE,
  WINBACK_DELETION_RULE,
  EMAIL_CATEGORY,
  type EmailCategory,
} from '@kernel/domain/email/email-schedule.config';
import type {
  CancelEmailRule,
  TrialEmailRule,
} from '@kernel/domain/email/email-schedule.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import { allowedEventLogTypeSets } from '@kernel/domain/event-log/event_log.config';
import { isEventInfoNarrower } from '@kernel/models/type_narrowing';
import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { EmailHistoryEntry } from '@domain/email/email.types';

type ScheduleResponse = {
  schedule: readonly TrialEmailRule[];
  cancelSchedule: readonly CancelEmailRule[];
  freeSchedule: {
    config: typeof FREE_EMAIL_CONFIG;
    rules: typeof FREE_EMAIL_RULES;
  };
};

type HistoryResponse = {
  emails: EmailHistoryEntry[];
  nextCursor: string | null;
};

/**
 * Map event name -> email category.
 * Built from SSOT schedule configs + known transactional events.
 */
const eventToCategoryMap = new Map<EVENT_INFO_TYPE, EmailCategory>();

// Trial + cancel schedule events (from config SSOT)
for (const rule of TRIAL_EMAIL_SCHEDULE) {
  eventToCategoryMap.set(rule.infoEvent, rule.category);
}
for (const rule of CANCEL_EMAIL_SCHEDULE) {
  eventToCategoryMap.set(rule.infoEvent, rule.category);
}
for (const rule of DUNNING_EMAIL_SCHEDULE) {
  eventToCategoryMap.set(rule.infoEvent, rule.category);
}
// Standalone single-rule configs (sweep operations) — without these the admin
// Email History panel showed their sends as category UNKNOWN.
for (const rule of [
  ONBOARDING_ABANDONMENT_RULE,
  RENEWAL_REMINDER_RULE,
  WINBACK_DELETION_RULE,
]) {
  eventToCategoryMap.set(rule.infoEvent, rule.category);
}

for (const rule of Object.values(FREE_EMAIL_RULES)) {
  eventToCategoryMap.set(rule.infoEvent, rule.category);
}

// Transactional events (not in schedule — triggered by business events)
const TRANSACTIONAL_EVENTS = [
  APP_EVENTS.INFO.EMAIL.EMAIL_UPGRADE_CONFIRMATION_SENT,
  APP_EVENTS.INFO.EMAIL.EMAIL_DOWNGRADE_NOTIFICATION_SENT,
  APP_EVENTS.INFO.EMAIL.EMAIL_PAIRING_NOTIFICATION_SENT,
  APP_EVENTS.INFO.EMAIL.EMAIL_PAYMENT_FAILED_SENT,
  // Dunning auto-downgrade notification (dunning-downgrade.operation.ts) —
  // billing-state change, cannot unsubscribe.
  APP_EVENTS.INFO.EMAIL.EMAIL_DUNNING_AUTO_DOWNGRADE,
  // Per-user dead-letter marker (magic-link / transactional send failed on all
  // transports) — the underlying email is transactional.
  APP_EVENTS.INFO.EMAIL.EMAIL_DEAD_LETTERED,
  // Admin-operational sends (EMAIL_ADMIN_*_SENT, ALERT_*_SENT) are deliberately not mapped here;
  // see the DECISION at EMAIL_HISTORY_CONTROL_EVENTS.
] as const;
for (const event of TRANSACTIONAL_EVENTS) {
  eventToCategoryMap.set(event, EMAIL_CATEGORY.TRANSACTIONAL);
}

// DECISION: EMAIL_HISTORY_CONTROL_EVENTS are EMAIL-bucket events that do not belong to a user's
// mail history: (A) control/audit markers that are not sends (preference changes, sweep marker,
// transport failure, circuit breaker); (B) admin-operational sends, which go to the ADMIN inbox but
// are logged under the affected user's id for correlation, so without exclusion a user would see
// e.g. EMAIL_ADMIN_CHURN_ALERT_SENT in their own history. Admin audit of those lives in the
// EventLog browser, not in the per-user endpoint. Exclude, never include as TRANSACTIONAL: this
// was flipped twice (excluding hid real sends; including showed admin mail in the user history). A NOT IN list (not a positive send set) is deliberate: a
// new user-facing send is visible by default. EMAIL_SEND_FAILED is control; EMAIL_DEAD_LETTERED is
// a per-user send marker (TRANSACTIONAL).
const EMAIL_HISTORY_CONTROL_EVENTS = [
  // (A) control/audit — nie-wysyłki
  APP_EVENTS.INFO.EMAIL.EMAIL_PREFERENCES_UPDATED,
  APP_EVENTS.INFO.EMAIL.EMAIL_LIFECYCLE_ENTRY_RECORDED,
  APP_EVENTS.INFO.EMAIL.EMAIL_LIFECYCLE_ACTIONS_FETCHED,
  APP_EVENTS.INFO.EMAIL.EMAIL_UNSUBSCRIBE_SUCCESS,
  APP_EVENTS.INFO.EMAIL.EMAIL_SWEEP_COMPLETED,
  APP_EVENTS.INFO.EMAIL.EMAIL_SEND_FAILED,
  APP_EVENTS.INFO.EMAIL.EMAIL_CIRCUIT_BREAKER_OPEN,
  APP_EVENTS.INFO.EMAIL.EMAIL_CIRCUIT_BREAKER_WARNING,
  APP_EVENTS.INFO.EMAIL.EMAIL_CIRCUIT_BREAKER_BLOCKED,
  // (B) admin-operacyjne wysyłki — mail do skrzynki admina, logowany pod id dotkniętego
  // usera (korelacja); NIE „mail wysłany do tego usera" → poza per-user historią.
  APP_EVENTS.INFO.EMAIL.EMAIL_ADMIN_SIGNUP_DIGEST_SENT,
  APP_EVENTS.INFO.EMAIL.EMAIL_ADMIN_CHURN_ALERT_SENT,
  APP_EVENTS.INFO.EMAIL.EMAIL_ADMIN_DOWNGRADE_ALERT_SENT,
  APP_EVENTS.INFO.EMAIL.ALERT_PAIRING_ANOMALY_SENT,
  APP_EVENTS.INFO.EMAIL.ALERT_UPLOAD_ERROR_RATE_SENT,
  APP_EVENTS.INFO.EMAIL.ALERT_IMPERSONATION_VOLUME_SENT,
  APP_EVENTS.INFO.EMAIL.ALERT_IMPERSONATION_OFF_HOURS_SENT,
] as const;

// DECISION: drift guard. Every control event must belong to the EMAIL bucket (event_log.policy), so
// a kernel rename fails fast at module init instead of becoming a silent no-op filter.
const emailBucket = allowedEventLogTypeSets[EventLogTypeValue.EMAIL];
for (const controlEvent of EMAIL_HISTORY_CONTROL_EVENTS) {
  if (!emailBucket.has(controlEvent)) {
    throw new Error(
      `email-query: control event "${controlEvent}" is not in the EMAIL EventLog bucket — event_log.policy drift`
    );
  }
}

/**
 * Resolve email category from event name.
 * Returns 'UNKNOWN' only if event name is not in any known mapping.
 */
const resolveEmailCategory = (
  eventName: EVENT_INFO_TYPE
): EmailCategory | 'UNKNOWN' => eventToCategoryMap.get(eventName) ?? 'UNKNOWN';

/**
 * Get the email schedule config.
 * Pure read-only — returns SSOT config, zero DB access.
 */
export const getEmailSchedule_IO = async (): Promise<
  OperationResult<ScheduleResponse, never>
> => {
  return success({
    schedule: TRIAL_EMAIL_SCHEDULE,
    cancelSchedule: CANCEL_EMAIL_SCHEDULE,
    freeSchedule: { config: FREE_EMAIL_CONFIG, rules: FREE_EMAIL_RULES },
  });
};

/**
 * Get email history for a specific user with cursor pagination (default 50, max 100).
 * Queries EventLog WHERE event_type = 'EMAIL' for the given userId.
 * Cursor by event_log_id; orderBy event_log_id desc for stable traversal.
 * Category is resolved from event name via schedule config (SSOT).
 */
export const getEmailHistory_IO = async (
  userId: string,
  pagination?: { cursor?: string | undefined; take?: number | undefined }
): Promise<
  OperationResult<HistoryResponse, DatabaseError | ValidationError>
> => {
  const cursor = pagination?.cursor;
  const take = pagination?.take ?? 50;
  const effectiveTake = Math.min(Math.max(take, 1), 100);

  // DECISION: format-gate the cursor before findMany (kernel isValidCursorFormat). A null byte or
  // other non-text cursor would throw in findMany as an unmapped 500; a malformed cursor is a uniform
  // 400 'Invalid cursor'. No existence pre-check: the client replays only server-issued cursors, so
  // 200-empty on a stale well-formed cursor is acceptable.
  if (cursor !== undefined && !isValidCursorFormat(cursor)) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'cursor',
      message: 'Invalid cursor',
    });
  }

  try {
    const eventLogs = await DB_CLIENT.use.eventLog.findMany({
      where: {
        event_type: EventLogTypeValue.EMAIL,
        created_by_user_id: userId,
        // DECISION: control events are excluded in the WHERE, not post-fetch, so the cursor pages over
        // the filtered set; a post-fetch filter could empty a page while older sends exist and the
        // client would show an empty history. Spread because Prisma `notIn` wants a mutable string[].
        event: { notIn: [...EMAIL_HISTORY_CONTROL_EVENTS] },
      },
      orderBy: { event_log_id: 'desc' },
      take: effectiveTake + 1,
      ...(cursor ? { cursor: { event_log_id: cursor }, skip: 1 } : {}),
      select: {
        event_log_id: true,
        event: true,
        created_at: true,
      },
    });

    const hasMore = eventLogs.length > effectiveTake;
    const pageItems = hasMore ? eventLogs.slice(0, effectiveTake) : eventLogs;
    const nextCursor =
      hasMore && pageItems.length > 0
        ? (pageItems[pageItems.length - 1]?.event_log_id ?? null)
        : null;

    // Send-vs-control is settled in the WHERE; rows here are only mapped. A new send missing from
    // the category map falls back to 'UNKNOWN' and is still shown.
    const emails: EmailHistoryEntry[] = pageItems.map(log => {
      // DB stores validated EVENT_INFO_TYPE values (written by writeRawEventLog_IO using APP_EVENTS SSOT).
      // Narrow defensively — corrupt DB rows fall back to GENERAL_ERROR rather than crashing the page.
      const narrowedEvent: EVENT_INFO_TYPE = isEventInfoNarrower(log.event)
        ? log.event
        : APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR;
      return {
        event_log_id: log.event_log_id,
        event: narrowedEvent,
        sentAt: log.created_at.toISOString(),
        category: resolveEmailCategory(narrowedEvent),
      };
    });

    return success({ emails, nextCursor });
  } catch (error) {
    return databaseFailure('getEmailHistory', error);
  }
};
