/**
 * Pre-renewal nudge.
 *
 * Sweep: paid, non-cancelled accounts whose period ends in 6-8 days.
 * Skip users with EMAIL_RENEWAL_REMINDER_7D_SENT in the last 25 days. That
 * window is shorter than a 30-day period, so the next cycle is not suppressed
 * by the previous reminder. Two sweeps that both read before either writes
 * can both send. This lookback is not current_period_start and not a unique key.
 * Category: TRANSACTIONAL. Sends regardless of email_marketing preference.
 */

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { TIME } from '@kernel/application/constants.config';
import {
  RENEWAL_REMINDER_RULE,
  EMAIL_CATEGORY,
  EMAIL_LIFECYCLE_CONFIG,
} from '@kernel/domain/email/email-schedule.config';
import {
  PaymentStatusValue,
  SubscriptionStatusValue,
} from '@kernel/models/db_models.generated.dto';
import { DB_CLIENT } from '@app/db/db.client';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { getPlanDisplayName } from '@kernel/domain/pricing/pricing.config';
import { getPricingPlanValueFromPlanId } from '@kernel/domain/stripe/stripe.config';
import { getLocaleOrDefault } from '@kernel/domain/i18n/i18n.config';
import { formatEmailDate } from '@domain/email/email-date.format';
import { isPrechargeReminderDisabled } from '@app/email-handler/email-precharge-reminder.policy';
import { formatEmailCurrency } from '@app/email-handler/email-currency.format';
import { readSubscriptionRenewal_IO } from '@app/stripe/subscription-billing.operations';
import { renderEmailTemplate } from '@app/email-handler/email-template.renderer';
import { sendLifecycleEmail } from '@app/email-handler/email-transport';
import { withEmailDeliveryRetry } from '@app/email-handler/email-retry.utils';
import { buildEmailUnsubscribeUrl } from '@app/email-handler/email-unsubscribe.url';
import { buildFrontendBaseUrl } from '@app/environment/environment.utils.api';
import { runWithConcurrency } from '@app/utils/concurrency.utils';
import { batchResolveLocales } from '@app/email-handler/lifecycle/email-locale-batch.resolver';
import { Prisma } from '../../../prisma/js-client';
import {
  noPriorEmailAudit,
  usersWithEmailAudit,
} from './email-audit-dedup.query';

const MS_PER_HOUR = TIME.MS_PER_HOUR;
const MS_PER_DAY = 24 * MS_PER_HOUR;

// DECISION: TRIALING is excluded because a trial's end IS current_period_end, so those
// accounts would get D23 and this mail at once; the trial sequence covers that moment.

export const renewalReminderExcludedStatuses = [
  SubscriptionStatusValue.CANCELED,
  SubscriptionStatusValue.PAST_DUE,
  SubscriptionStatusValue.UNPAID,
  SubscriptionStatusValue.TRIALING,
] as const;

/**
 * Paid accounts whose period ends inside the reminder window around
 * now + 7 days. Shared by the sweep and the admin queue preview
 * (email-pipeline.query.ts), which evaluates it at "now" and "now + 24 h".
 */
const renewalReminderWindow = (now: Date): { start: Date; end: Date } => {
  const windowHalfMs =
    (RENEWAL_REMINDER_RULE.triggerWindowHours / 2) * MS_PER_HOUR;
  const targetMs = RENEWAL_REMINDER_RULE.triggerDaysBeforeRenewal * MS_PER_DAY;
  return {
    start: new Date(now.getTime() + targetMs - windowHalfMs),
    end: new Date(now.getTime() + targetMs + windowHalfMs),
  };
};

export const queryRenewalReminderCandidates = async (now: Date) => {
  const window = renewalReminderWindow(now);
  const periodLookbackDate = new Date(now.getTime() - 25 * MS_PER_DAY);
  // EventLog deliberately has no Prisma relation to User. Apply the audit
  // exclusion in SQL before LIMIT, so previously processed accounts cannot
  // permanently occupy every slot in the next sweep.
  const eligible = await DB_CLIENT.use.$queryRaw<
    Array<{ account_id: string }>
  >(Prisma.sql`
    SELECT a."account_id"
      FROM "StylistAccount" a
      JOIN "users" u ON u."id" = a."created_by_user_id"
     WHERE a."payment_status"::text = ${PaymentStatusValue.PAID}
       AND a."subscription_status"::text NOT IN (${Prisma.join(renewalReminderExcludedStatuses)})
       AND a."current_period_end" >= ${window.start}
       AND a."current_period_end" <= ${window.end}
       AND a."cancel_at_period_end" IS NOT TRUE
       AND u."is_active" = true
       AND ${noPriorEmailAudit(Prisma.sql`a."created_by_user_id"`, APP_EVENTS.INFO.EMAIL.EMAIL_RENEWAL_REMINDER_7D_SENT, periodLookbackDate)}
     ORDER BY a."current_period_end" ASC, a."account_id" ASC
     LIMIT ${EMAIL_LIFECYCLE_CONFIG.MAX_EMAILS_PER_SWEEP}
  `);
  if (eligible.length === 0) {
    return [];
  }
  return DB_CLIENT.use.stylistAccount.findMany({
    where: {
      account_id: { in: eligible.map(account => account.account_id) },
      payment_status: PaymentStatusValue.PAID,
      // NOT cancelled, NOT in dunning. payment_status=PAID juz wyklucza dunning
      // (SCDUN-1: PAST_DUE/UNPAID -> IN_PROGRESS), ale to defense-in-depth (SCDUN-2):
      // konto w dunningu NIE moze dostac maila "odnowi sie za 7 dni".
      // cancel_at_period_end=true = anuluje na koniec okresu, nadal active (skip nizej).
      subscription_status: {
        notIn: [...renewalReminderExcludedStatuses],
      },
      current_period_end: {
        gte: window.start,
        lte: window.end,
      },
      OR: [{ cancel_at_period_end: false }, { cancel_at_period_end: null }],
      created_by_user: {
        is_active: true,
      },
    },
    select: {
      account_id: true,
      subscription_id: true,
      pricing_plan: true,
      current_period_end: true,
      cancel_at_period_end: true,
      created_by_user_id: true,
      created_by_user: {
        select: {
          email: true,
          name: true,
        },
      },
    },
    // DECISION: orderBy current_period_end asc + the MAX_EMAILS_PER_SWEEP cap + a cap-hit warn
    // (parity with winback-deletion). Without orderBy the LIMIT returns an arbitrary subset, so with
    // more accounts than the cap in the 6-8 day window the same first batch wins every sweep and the
    // rest never get a pre-charge notice (48 h window plus the 25-day lookback). asc serves the nearest
    // charge first.
    orderBy: [{ current_period_end: 'asc' }, { account_id: 'asc' }],
  });
};

/** Users from `userIds` already reminded in the current renewal period. */
export const fetchRenewalReminderSent = async (
  userIds: readonly string[],
  now: Date
): Promise<Set<string>> => {
  // Skip users with EMAIL_RENEWAL_REMINDER_7D_SENT in the last 25 days. That
  // window is shorter than a 30-day period, so the next cycle is not suppressed
  // by the previous reminder. Two sweeps that both read before either writes
  // can both send. This is not current_period_start and not a unique claim.
  const periodLookbackDate = new Date(now.getTime() - 25 * MS_PER_DAY);
  return usersWithEmailAudit(
    userIds,
    APP_EVENTS.INFO.EMAIL.EMAIL_RENEWAL_REMINDER_7D_SENT,
    periodLookbackDate
  );
};

/**
 * Send pre-renewal reminder emails (7 days before charge).
 *
 * Triggered from email lifecycle sweep (safeStep).
 * Returns number of emails sent.
 */
export const sendRenewalReminderEmails_IO = async (): Promise<number> => {
  if (isPrechargeReminderDisabled(RENEWAL_REMINDER_RULE.bodyTemplateId)) {
    return 0;
  }
  try {
    const now = new Date();
    const accounts = await queryRenewalReminderCandidates(now);

    if (accounts.length === 0) {
      return 0;
    }

    if (accounts.length === EMAIL_LIFECYCLE_CONFIG.MAX_EMAILS_PER_SWEEP) {
      reportIssueBackend({
        namespace: 'RENEWAL_REMINDER_SWEEP_CAP_HIT',
        message: `Renewal-reminder sweep hit the per-sweep cap (${EMAIL_LIFECYCLE_CONFIG.MAX_EMAILS_PER_SWEEP}); accounts beyond the cap in the 6-8d window are deferred to the next sweep`,
        payload: {},
        mode: 'warn',
      });
    }

    const userIds = accounts.map(a => a.created_by_user_id);

    // Skip users already in the 25-day lookback (see fetchRenewalReminderSent).
    const alreadySent = await fetchRenewalReminderSent(userIds, now);

    // 3. Batch-resolve locale via the canonical SSOT helper (eliminates the
    //    re-implemented distinct-no-take block; same query the inline version mirrored).
    //    Helper is fail-open (locale-query error → empty map → all users default 'pl')
    //    so a locale lookup hiccup cannot abort the whole reminder sweep.
    const localeMap = await batchResolveLocales(userIds);

    // 4. Process with bounded concurrency
    const results = await runWithConcurrency(accounts, 5, async account => {
      try {
        const email = account.created_by_user.email;
        if (!email) {
          return 0;
        }

        // Skip cancel_at_period_end=true accounts: they will not be charged, so a "you will be
        // charged" reminder would mislead.
        if (account.cancel_at_period_end === true) {
          return 0;
        }

        // Skip when the 25-day lookback already lists this user
        const userId = account.created_by_user_id;
        if (alreadySent.has(userId)) {
          return 0;
        }

        // TRANSACTIONAL emails are NOT subject to frequency cap (exempt)
        // — per EMAIL_FREQUENCY_CAP.EXEMPT_CATEGORIES in email-schedule.config.ts

        const locale = getLocaleOrDefault(localeMap.get(userId) ?? 'pl');
        const displayName = account.created_by_user.name || '';
        const renewal = await readSubscriptionRenewal_IO(
          account.subscription_id,
          account.account_id,
          renewalReminderWindow(now)
        );
        if (renewal.kind === 'invalid' || renewal.kind === 'not_renewing') {
          reportIssueBackend({
            namespace: 'RENEWAL_REMINDER_SKIPPED',
            message: 'Renewal reminder skipped after subscription check',
            payload: { reason: renewal.reason, accountId: account.account_id },
            mode: 'warn',
          });
          return 0;
        }
        const renewalDate =
          renewal.kind === 'available'
            ? new Date(renewal.nextChargeAt)
            : account.current_period_end;
        if (renewalDate == null || !Number.isFinite(renewalDate.getTime())) {
          reportIssueBackend({
            namespace: 'RENEWAL_REMINDER_SKIPPED',
            message: 'Renewal reminder skipped without a valid renewal date',
            payload: {
              reason: 'invalid_renewal_date',
              accountId: account.account_id,
            },
            mode: 'warn',
          });
          return 0;
        }
        // DECISION: a TRANSACTIONAL mail offers no unsubscribe link or headers (parity with
        // email-transactional.ts): processUnsubscribe_IO rejects such a token with
        // EMAIL_TRANSACTIONAL_NOT_UNSUBSCRIBABLE, so a link would always fail. An empty
        // unsubscribeUrl suppresses the footer link and the headers; the condition follows
        // rule.category, so the link returns by itself if the category changes.
        const isTransactional =
          RENEWAL_REMINDER_RULE.category === EMAIL_CATEGORY.TRANSACTIONAL;
        const unsubscribeUrl = isTransactional
          ? ''
          : buildEmailUnsubscribeUrl(
              userId,
              RENEWAL_REMINDER_RULE.category,
              locale
            );
        const appBaseUrl = buildFrontendBaseUrl();

        const vars: Record<string, string> = {
          displayName,
          appUrl: appBaseUrl,
          planName: getPlanDisplayName(
            renewal.kind === 'available'
              ? getPricingPlanValueFromPlanId(renewal.planId)
              : account.pricing_plan
          ),
          renewalDate: formatEmailDate(renewalDate, locale),
        };
        const amount =
          renewal.kind === 'available'
            ? formatEmailCurrency(renewal.amountMinor, renewal.currency, locale)
            : null;
        if (amount === null) {
          reportIssueBackend({
            namespace: 'RENEWAL_REMINDER_QUOTE_UNAVAILABLE',
            message: 'Renewal amount unavailable; using reminder fallback',
            payload: {
              reason:
                renewal.kind === 'unavailable'
                  ? renewal.reason
                  : 'currency_format_failed',
              accountId: account.account_id,
            },
            mode: 'warn',
          });
        }
        if (amount !== null) {
          vars['renewalAmount'] = amount;
        }

        const rendered = renderEmailTemplate(
          RENEWAL_REMINDER_RULE.bodyTemplateId,
          vars,
          locale,
          unsubscribeUrl,
          RENEWAL_REMINDER_RULE.subjectKey
        );

        const sent = await withEmailDeliveryRetry(isFinalAttempt =>
          sendLifecycleEmail({
            to: email,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            templateId: RENEWAL_REMINDER_RULE.bodyTemplateId,
            category: RENEWAL_REMINDER_RULE.category,
            // Dead-letter exactly once per incident (final retry attempt only)
            deadLetterOnFailure: isFinalAttempt,
            tags: [
              'lifecycle',
              RENEWAL_REMINDER_RULE.id.toLowerCase(),
              RENEWAL_REMINDER_RULE.category.toLowerCase(),
            ],
            // No List-Unsubscribe* for TRANSACTIONAL (unsubscribeUrl === ''); see the DECISION above.
            headers: unsubscribeUrl
              ? {
                  'List-Unsubscribe': `<${unsubscribeUrl}>`,
                  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
                }
              : {},
          })
        );

        if (sent) {
          // Dedup write AWAITED (pattern: winback-dedup-await) — mail
          // TRANSACTIONAL (omija frequency-cap/opt-out), a konto pasuje do query
          // przez kilka kolejnych sweepów; crash/deploy między wysyłką a
          // nie-awaitowanym zapisem dawał duplikat finansowego powiadomienia.
          // recordAuditEvent_IO jest never-throw; defensywnie logujemy i NIE
          // flipujemy wysłanego maila na resend.
          try {
            await recordAuditEvent_IO({
              eventName: APP_EVENTS.INFO.EMAIL.EMAIL_RENEWAL_REMINDER_7D_SENT,
              user: { id: userId },
              responseBody: {
                accountId: account.account_id,
                templateId: RENEWAL_REMINDER_RULE.bodyTemplateId,
                category: RENEWAL_REMINDER_RULE.category,
                currentPeriodEnd:
                  renewal.kind === 'available'
                    ? renewal.nextChargeAt
                    : account.current_period_end?.toISOString(),
                renewalOutcome: amount === null ? 'unavailable' : 'available',
              },
            });
          } catch (auditErr) {
            reportIssueBackend({
              namespace: 'RENEWAL_REMINDER_DEDUP_WRITE_ERROR',
              message: `Renewal reminder sent but dedup audit write threw for account ${account.account_id} — counted as sent to avoid resend`,
              payload: auditErr,
              mode: 'error',
            });
          }
          return 1;
        }
        return 0;
      } catch (err) {
        reportIssueBackend({
          namespace: 'RENEWAL_REMINDER_EMAIL_ERROR',
          message: `Failed to send renewal reminder for account ${account.account_id}`,
          payload: err,
          mode: 'error',
        });
        return 0;
      }
    });

    return results.reduce<number>((sum, n) => sum + n, 0);
  } catch (error) {
    reportIssueBackend({
      namespace: 'RENEWAL_REMINDER_SWEEP_ERROR',
      message: 'sendRenewalReminderEmails_IO failed',
      payload: error,
      mode: 'error',
    });
    return 0;
  }
};
