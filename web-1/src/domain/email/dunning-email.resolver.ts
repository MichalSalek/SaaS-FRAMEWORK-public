/**
 * Dunning Email Resolver
 *
 * SRP: For a given Stripe invoice attempt_count, determine which dunning email to send.
 * Pure domain logic — no I/O, no side effects.
 *
 * Dunning emails are TRANSACTIONAL — they cannot be unsubscribed.
 * Dedup is handled by checking EventLog for already-sent events (same pattern as trial emails).
 */

import { DUNNING_EMAIL_SCHEDULE } from '@kernel/domain/email/email-schedule.config';
import type { DunningEmailRule } from '@kernel/domain/email/email-schedule.types';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';

// The attempt_count -> DunningEmailRule mapping is a pure business rule without I/O, so it lives in
// domain/ like trial-email.resolver; sweep orchestration lives in application/email-handler/lifecycle.

/**
 * Match attempt_count to a DunningEmailRule.
 *
 * @param attemptCount - Stripe invoice.attempt_count (1-based)
 * @returns Matching DunningEmailRule or null if no match
 */
export const resolveDunningEmail = (
  attemptCount: number
): DunningEmailRule | null => {
  for (const rule of DUNNING_EMAIL_SCHEDULE) {
    if (typeof rule.triggerAttempt === 'number') {
      if (attemptCount === rule.triggerAttempt) {
        return rule;
      }
    } else {
      const { min, max } = rule.triggerAttempt;
      if (attemptCount >= min && (max === undefined || attemptCount <= max)) {
        return rule;
      }
    }
  }
  return null;
};

/**
 * Check if a dunning email has already been sent for this user.
 *
 * @param sentEvents - Set of INFO event names already sent
 * @param rule - The DunningEmailRule to check
 * @returns true if already sent
 */
export const isDunningEmailAlreadySent = (
  sentEvents: Set<EVENT_INFO_TYPE>,
  rule: DunningEmailRule
): boolean => sentEvents.has(rule.infoEvent);
