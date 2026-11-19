import { sendScheduledLifecycleEmail } from './scheduled-lifecycle.send';
import {
  queryTrialAccounts,
  buildTrialSweepContext,
} from './trial-sweep.query';
/**
 * Sends the due trial rules for one account. Isolated so the sweep query
 * stays under the file line cap. Must not throw.
 */

import { SubscriptionStatusValue } from '@kernel/models/db_models.generated.dto';
import type { EmailPreferences } from '@kernel/models/email/email.dto';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import {
  calculateTrialDay,
  resolveTrialEmails,
} from '@domain/email/trial-email.resolver';
import { isPrechargeReminderDisabled } from '@app/email-handler/email-precharge-reminder.policy';
import {
  resolvePersonalization,
  type PersonalizationExtras,
} from '@domain/email/email-personalization.resolver';
import {
  issueFirstMonthOffer_IO,
  type IssuedEmailOffer,
} from '@domain/email/email-offer.issuer';
import { buildEmailUnsubscribeUrl } from '@app/email-handler/email-unsubscribe.url';
import type { StylistAccountWithStats } from '@domain/email/email.types';
import { canSendEmailFromCache } from '@app/email-handler/lifecycle/email-frequency.guard';
import type { TrialAccountRow, TrialSweepContext } from './trial-sweep.query';

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
  // DECISION: preferences are read from the typed Boolean columns (email_marketing,
  // email_trial_sequence); the JSON `email_preferences` column stays as a rollback shadow until a
  // separate change drops it.
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

export const processTrialAccount = async (
  account: TrialAccountRow,
  context: TrialSweepContext,
  sweepId?: string
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
      if (isPrechargeReminderDisabled(rule.bodyTemplateId)) {
        continue;
      }
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
        // DECISION: D29 carries no offer card; its only promise is "the discount is already
        // applied". offerCode drives the discount subject, so on D29 it is set only when Stripe
        // actually applied the code, or the subject would promise 20% the body never mentions.
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
      const unsubscribeUrl =
        rule.category === 'TRANSACTIONAL'
          ? ''
          : buildEmailUnsubscribeUrl(userId, rule.category, locale);

      const result = await sendScheduledLifecycleEmail({
        userId,
        accountId: account.account_id,
        email,
        family: 'trial',
        ruleId: rule.id,
        occurrence: `trial:${account.trial_started_at?.toISOString()}`,
        templateId: rule.bodyTemplateId,
        subjectKey: rule.subjectKey,
        locale,
        category: rule.category,
        vars,
        unsubscribeUrl,
        ...(sweepId ? { sweepId } : {}),
        validate: async () => {
          const fresh = (
            await queryTrialAccounts(new Date(), null, account.account_id)
          )[0];
          if (
            !fresh ||
            fresh.trial_started_at?.getTime() !==
              account.trial_started_at?.getTime() ||
            fresh.trial_ends_at?.getTime() !== account.trial_ends_at?.getTime()
          ) {
            return false;
          }
          const current = await buildTrialSweepContext([fresh]);
          const view = toTrialAccountView(fresh, current);
          return resolveTrialEmails(
            view.accountWithStats,
            view.sentEvents,
            view.prefs
          ).some(candidate => candidate.id === rule.id);
        },
      });
      const sent = result.status === 'accepted';

      if (sent) {
        // Dedup write is awaited (same as winback-deletion), not fire-and-forget.
        // The next sweep reads this EventLog row before sending again.
        // A crash between send and an un-awaited write left a second send.
        // recordAuditEvent_IO swallows its own errors; if that contract regresses
        // we log and do not hand the sent mail to Resend again.
        try {
          await recordAuditEvent_IO({
            eventName: rule.infoEvent,
            user: { id: userId },
            responseBody: {
              lifecycleMessageId: result.messageId,
              templateId: rule.bodyTemplateId,
              category: rule.category,
              trialDay: account.trial_started_at
                ? calculateTrialDay(account.trial_started_at)
                : null,
              triggerAnchor: rule.triggerAnchor,
              triggerOffsetDays: rule.triggerOffsetDays,
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
