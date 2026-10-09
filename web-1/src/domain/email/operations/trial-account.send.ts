/**
 * Sends the due trial rules for one account. Isolated so the sweep query
 * stays under the file line cap. Must not throw.
 */

import { SubscriptionStatusValue } from '@kernel/models/db_models.generated.dto';
import type { EmailPreferences } from '@kernel/models/email/email.dto';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { resolveTrialEmails } from '@domain/email/trial-email.resolver';
import {
  resolvePersonalization,
  type PersonalizationExtras,
} from '@domain/email/email-personalization.resolver';
import {
  issueFirstMonthOffer_IO,
  type IssuedEmailOffer,
} from '@domain/email/email-offer.issuer';
import { renderEmailTemplate } from '@app/email-handler/email-template.renderer';
import { sendLifecycleEmail } from '@app/email-handler/email-transport';
import { withEmailDeliveryRetry } from '@app/email-handler/email-retry.utils';
import { buildEmailUnsubscribeUrl } from '@app/email-handler/email-unsubscribe.url';
import type { StylistAccountWithStats } from '@domain/email/email.types';
import { canSendEmailFromCache } from '@app/email-handler/lifecycle/email-frequency.guard';
import type {
  TrialAccountRow,
  TrialSweepContext,
} from './trial-emails.operation';

/**
 * The account as the trial resolver sees it: typed preferences, events
 * already sent and the stats shape. Shared by the sweep and the admin queue
 * preview (email-pipeline.query.ts), so both decide on exactly the same input.
 */
export const toTrialAccountView = (
  account: TrialAccountRow,
  context: TrialSweepContext
): {
  prefs: EmailPreferences;
  sentEvents: Set<EVENT_INFO_TYPE>;
  accountWithStats: StylistAccountWithStats;
} => {
  const userId = account.created_by_user_id;
  // DECISION (PRMA email_preferences Phase 2, 2026-05-27):
  // Reads z typed Boolean columns (email_marketing, email_trial_sequence).
  // JSON `email_preferences` zachowany jako shadow dla rollback safety.
  // Phase 3 (separate PR) — drop JSON column po zweryfikowaniu zero rollback need.
  const prefs: EmailPreferences = {
    trial_sequence: account.email_trial_sequence,
    marketing: account.email_marketing,
  };

  // Get sent events for this user (per-user Set — no cross-worker contention,
  // each userId appears at most once in `accounts`)
  const sentEvents =
    context.sentEventsMap.get(userId) ?? new Set<EVENT_INFO_TYPE>();

  // Build account with stats shape
  const accountWithStats: StylistAccountWithStats = {
    account_id: account.account_id,
    trial_started_at: account.trial_started_at,
    trial_ends_at: account.trial_ends_at,
    payment_status: account.payment_status,
    subscription_status: account.subscription_status,
    pricing_plan: account.pricing_plan,
    display_name: account.display_name,
    email_preferences: prefs,
    email_marketing: account.email_marketing,
    email_trial_sequence: account.email_trial_sequence,
    created_by_user_id: userId,
    created_by_user: account.created_by_user,
    _count: account._count,
    stylist_pairings_count:
      context.pairingCountMap.get(account.account_id) ?? 0,
    stripe_customer_id: account.stripe_customer_id,
    subscription_id: account.subscription_id,
    cancel_at_period_end: account.cancel_at_period_end,
  };

  return { prefs, sentEvents, accountWithStats };
};

/**
 * Process a single trial account against the shared sweep context.
 * MUST NOT throw — returns 0 on error (per-account isolation), counts summed by caller.
 */
export const processTrialAccount = async (
  account: TrialAccountRow,
  context: TrialSweepContext
): Promise<number> => {
  try {
    const userId = account.created_by_user_id;
    const email = account.created_by_user.email;

    // Skip accounts without email (shouldn't happen — email is required, but guard)
    if (!email) {
      return 0;
    }

    const { prefs, sentEvents, accountWithStats } = toTrialAccountView(
      account,
      context
    );

    const emailsToSend = resolveTrialEmails(
      accountWithStats,
      sentEvents,
      prefs
    );
    if (emailsToSend.length === 0) {
      return 0;
    }

    // Resolve locale from pre-fetched map (M12 fix — no per-user query)
    const locale = context.localeMap.get(userId) ?? 'pl';

    let localCount = 0;

    // Send each email (sequential per account — usually 1, max ~3)
    for (const rule of emailsToSend) {
      // Double-check dedup (race condition protection)
      if (sentEvents.has(rule.infoEvent)) {
        continue;
      }

      // Frequency cap (batch-fetched, H13 fix). The batch count is a snapshot
      // from BEFORE this sweep — add localCount (emails already sent to this
      // user in THIS iteration), otherwise a user due 3 rules would get all 3
      // in one sweep despite MAX_PER_WEEK=2.
      const emailCount = context.frequencyCountMap.get(userId) ?? 0;
      if (!canSendEmailFromCache(emailCount + localCount, rule.category)) {
        continue;
      }

      const extras: PersonalizationExtras = {
        locale,
        endedTrialPlan: context.endedTrialPlanMap.get(userId) ?? null,
      };
      let issuedOffer: IssuedEmailOffer | null = null;
      if (
        rule.bodyTemplateId === 'trial-last-day' ||
        rule.bodyTemplateId === 'trial-winback'
      ) {
        const applyToSubscription =
          rule.bodyTemplateId === 'trial-last-day' &&
          account.subscription_status === SubscriptionStatusValue.TRIALING &&
          account.cancel_at_period_end !== true &&
          Boolean(account.subscription_id);
        issuedOffer = await issueFirstMonthOffer_IO({
          userId,
          templateId: rule.bodyTemplateId,
          infoEvent: rule.infoEvent,
          displayName:
            account.display_name || account.created_by_user.name || '',
          stripeCustomerId: account.stripe_customer_id,
          applyToSubscriptionId: applyToSubscription
            ? account.subscription_id
            : null,
        });
        // DECISION (nie usuwaj tego komentarza, 2026-09-23):
        // D29 carries no offer card: its only promise is "the discount is
        // already applied". offerCode picks the discount subject, so on D29 it
        // is set only when Stripe actually applied the code; otherwise the
        // subject would promise 20% that the body never mentions.
        const offerReachesReader =
          rule.bodyTemplateId !== 'trial-last-day' || issuedOffer?.applied;
        if (issuedOffer && offerReachesReader) {
          extras.offerCode = issuedOffer.code;
          extras.offerExpiresAt = issuedOffer.expiresAt;
        }
      }

      const vars = resolvePersonalization(accountWithStats, rule, extras);
      if (issuedOffer?.applied) {
        vars['offerApplied'] = '1';
      }
      const unsubscribeUrl = buildEmailUnsubscribeUrl(
        userId,
        rule.category,
        locale
      );

      const rendered = renderEmailTemplate(
        rule.bodyTemplateId,
        vars,
        locale,
        unsubscribeUrl,
        rule.subjectKey
      );

      // Send with List-Unsubscribe headers (RFC 2369 + RFC 8058).
      // Retry on transient failures: lifecycle emails next attempt is 6h away,
      // so the upfront cost of 1-2 retries is worth it for delivery reliability.
      const sent = await withEmailDeliveryRetry(isFinalAttempt =>
        sendLifecycleEmail({
          to: email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          templateId: rule.bodyTemplateId,
          category: rule.category,
          // Dead-letter exactly once per incident: only the final retry attempt
          // may write FailedEmail + EMAIL_SEND_FAILED.
          deadLetterOnFailure: isFinalAttempt,
          tags: [
            'lifecycle',
            rule.id.toLowerCase(),
            rule.category.toLowerCase(),
          ],
          headers: {
            'List-Unsubscribe': `<${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        })
      );

      if (sent) {
        // Dedup write AWAITED (pattern: winback-dedup-await w winback-deletion) —
        // NIE fire-and-forget. Warunek `rule.triggerDay <= trialDay` jest
        // MONOTONICZNY (raz spełniony — spełniony do końca triala), więc wpis w
        // EventLog to jedyny trwały guard przed re-wysyłką w każdym kolejnym
        // sweepie (~6h). Crash/deploy między wysyłką a nie-awaitowanym zapisem
        // otwierał okno duplikatu. recordAuditEvent_IO połyka błędy wewnętrznie
        // (never-throw); na wypadek regresji kontraktu logujemy i NIE flipujemy
        // wysłanego maila na resend.
        try {
          await recordAuditEvent_IO({
            eventName: rule.infoEvent,
            user: { id: userId },
            responseBody: {
              templateId: rule.bodyTemplateId,
              category: rule.category,
              trialDay: rule.triggerDay,
              ...(issuedOffer
                ? {
                    promotionCodeId: issuedOffer.promotionCodeId,
                    promotionCode: issuedOffer.code,
                    offerExpiresAt: issuedOffer.expiresAt.toISOString(),
                    offerApplied: issuedOffer.applied,
                  }
                : {}),
            },
          });
        } catch (auditErr) {
          reportIssueBackend({
            namespace: 'TRIAL_EMAIL_DEDUP_WRITE_ERROR',
            message: `Trial email sent but dedup audit write threw for user ${userId} — counted as sent to avoid resend`,
            payload: auditErr,
            mode: 'error',
          });
        }

        // Update local set to prevent sending duplicate in same sweep
        sentEvents.add(rule.infoEvent);
        localCount += 1;
      }
    }

    return localCount;
  } catch (accountError) {
    // Error isolation — one account failure doesn't block others
    reportIssueBackend({
      namespace: 'EMAIL_LIFECYCLE_ACCOUNT_ERROR',
      message: `Failed to process account ${account.account_id}`,
      payload: accountError,
      mode: 'error',
    });
    return 0;
  }
};

/**
 * Run the trial-email sweep phase: query trial accounts, build the shared lookup
 * context, then send due trial emails per account under bounded concurrency.
 *
 * Returns counts for the orchestrator's completion log. Throws nothing per account
 * (isolation in `processTrialAccount`); a failed query propagates to the caller's
 * sweep-level error handling (same as before extraction).
 */
