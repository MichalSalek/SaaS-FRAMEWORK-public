/**
 * Email Frequency Guard
 *
 * SRP: Determine if a non-transactional email can be sent to a user
 * based on the weekly frequency cap (EMAIL_FREQUENCY_CAP.MAX_PER_WEEK).
 *
 * TRANSACTIONAL emails (payment, magic link, dunning) are EXEMPT — always allowed.
 */

import {
  EMAIL_FREQUENCY_CAP,
  TRIAL_EMAIL_SCHEDULE,
  CANCEL_EMAIL_SCHEDULE,
  DUNNING_EMAIL_SCHEDULE,
  ONBOARDING_ABANDONMENT_RULE,
  RENEWAL_REMINDER_RULE,
  WINBACK_DELETION_RULE,
  type EmailCategory,
} from '@kernel/domain/email/email-schedule.config';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import { TIME } from '@kernel/application/constants.config';
import { DB_CLIENT } from '@app/db/db.client';

const MS_PER_WEEK = 7 * TIME.MS_PER_DAY;

// DECISION (nie usuwaj tego komentarza):
// ALLOW-LIST derived from schedule configs (SSOT), NOT a hand-maintained deny-list.
// Previous deny-list (`startsWith: 'EMAIL_'` minus exclusions) silently counted every
// NEW marker event (EMAIL_DEAD_LETTERED, EMAIL_CIRCUIT_BREAKER_BLOCKED, ...) and new
// transactional sends (EMAIL_RENEWAL_REMINDER_7D_SENT, EMAIL_CANCEL_D1_SENT) toward
// the weekly cap until someone remembered to extend the exclusions — starving real
// lifecycle emails. Counted = events of scheduled rules whose category is NOT exempt
// (TRANSACTIONAL). STRAŻNIK: when you add a NEW schedule config / standalone rule to
// email-schedule.config.ts, append it to ALL_SCHEDULED_EMAIL_RULES below — otherwise
// its sends will not count toward the cap.
const ALL_SCHEDULED_EMAIL_RULES: readonly {
  readonly category: EmailCategory;
  readonly infoEvent: EVENT_INFO_TYPE;
}[] = [
  ...TRIAL_EMAIL_SCHEDULE,
  ...CANCEL_EMAIL_SCHEDULE,
  ...DUNNING_EMAIL_SCHEDULE,
  ONBOARDING_ABANDONMENT_RULE,
  RENEWAL_REMINDER_RULE,
  WINBACK_DELETION_RULE,
];

/**
 * Event names counted toward the weekly frequency cap.
 * Derived: every scheduled rule whose category is not cap-exempt.
 */
const COUNTED_EMAIL_EVENTS: readonly EVENT_INFO_TYPE[] =
  ALL_SCHEDULED_EMAIL_RULES.filter(
    rule => !EMAIL_FREQUENCY_CAP.EXEMPT_CATEGORIES.includes(rule.category)
  ).map(rule => rule.infoEvent);

/**
 * Batch-fetch non-transactional email counts for multiple users (N+1 prevention).
 * Returns Map<userId, count> — users not in the map have 0 emails.
 *
 * @param userIds - List of user IDs to check
 * @returns Map of userId to recent non-transactional email count
 */
export const batchGetEmailFrequencyCounts_IO = async (
  userIds: string[]
): Promise<Map<string, number>> => {
  const countMap = new Map<string, number>();
  if (userIds.length === 0) {
    return countMap;
  }

  const oneWeekAgo = new Date(Date.now() - MS_PER_WEEK);

  const grouped = await DB_CLIENT.use.eventLog.groupBy({
    by: ['created_by_user_id'],
    where: {
      event_type: EventLogTypeValue.EMAIL,
      created_by_user_id: { in: userIds },
      created_at: { gte: oneWeekAgo },
      event: { in: [...COUNTED_EMAIL_EVENTS] },
    },
    _count: true,
  });

  for (const row of grouped) {
    countMap.set(row.created_by_user_id, row._count);
  }

  return countMap;
};

/**
 * Check frequency cap using pre-fetched counts (no DB call).
 *
 * @param count - Pre-fetched email count for the user
 * @param category - Email category (TRANSACTIONAL always passes)
 * @returns true if the email can be sent
 */
export const canSendEmailFromCache = (
  count: number,
  category: EmailCategory
): boolean => {
  if (EMAIL_FREQUENCY_CAP.EXEMPT_CATEGORIES.includes(category)) {
    return true;
  }
  return count < EMAIL_FREQUENCY_CAP.MAX_PER_WEEK;
};
