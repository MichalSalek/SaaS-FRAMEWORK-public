/**
 * Pre-Renewal Nudge Operation
 *
 * Sweep step: find paid, non-cancelled accounts whose subscription renews in
 * 6-8 days (target: 7d). Sends a single informed-consent email per renewal period.
 *
 * Idempotency: EventLog EMAIL_RENEWAL_REMINDER_7D_SENT dedup within the current
 * renewal period (checked via created_at >= current_period_start).
 *
 * Category: TRANSACTIONAL — must send regardless of email_marketing preference.
 * Financial notification — PSD2/SCA best practice, UOKiK Art. 6(1)(b) basis.
 */

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { TIME } from '@kernel/application/constants.config';
import {
  RENEWAL_REMINDER_RULE,
  EMAIL_CATEGORY,
  EMAIL_LIFECYCLE_CONFIG,
} from '@kernel/domain/email/email-schedule.config';
import {
  EventLogTypeValue,
  PaymentStatusValue,
  SubscriptionStatusValue,
} from '@kernel/models/db_models.generated.dto';
import { DB_CLIENT } from '@app/db/db.client';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { getPlanDisplayName } from '@kernel/domain/pricing/pricing.config';
import { getLocaleOrDefault } from '@kernel/domain/i18n/i18n.config';
import { formatEmailDate } from '@domain/email/email-date.format';
import { renderEmailTemplate } from '@app/email-handler/email-template.renderer';
import { sendLifecycleEmail } from '@app/email-handler/email-transport';
import { withEmailDeliveryRetry } from '@app/email-handler/email-retry.utils';
import { buildEmailUnsubscribeUrl } from '@app/email-handler/email-unsubscribe.url';
import { buildFrontendBaseUrl } from '@app/environment/environment.utils.api';
import { runWithConcurrency } from '@app/utils/concurrency.utils';
import { batchResolveLocales } from '@app/email-handler/lifecycle/email-locale-batch.resolver';

const MS_PER_HOUR = TIME.MS_PER_HOUR;
const MS_PER_DAY = 24 * MS_PER_HOUR;

// DECISION (nie usuwaj tego komentarza):
// Mail podaje nazwę planu z pricing_plan i datę current_period_end. Kwoty nadal nie
// podajemy: Stripe jest SSOT ceny, a w mailu nie ma świeżego odczytu upcoming invoice.
// TRIALING jest wykluczony z zapytania. Koniec okresu trialingowego JEST current_period_end,
// więc te konta dostałyby jednocześnie ostrzeżenie D23 i ten mail. Sekwencja trialowa
// pokrywa ten moment.

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
export const queryRenewalReminderCandidates = (now: Date) => {
  // Target window: current_period_end is 6-8 days from now (7d ± 12h tolerance)
  const windowHalfMs =
    (RENEWAL_REMINDER_RULE.triggerWindowHours / 2) * MS_PER_HOUR;
  const targetMs = RENEWAL_REMINDER_RULE.triggerDaysBeforeRenewal * MS_PER_DAY;
  const renewalWindowStart = new Date(now.getTime() + targetMs - windowHalfMs);
  const renewalWindowEnd = new Date(now.getTime() + targetMs + windowHalfMs);

  // 1. Find paid, non-cancelled accounts with renewal in the 6-8d window
  return DB_CLIENT.use.stylistAccount.findMany({
    where: {
      payment_status: PaymentStatusValue.PAID,
      // NOT cancelled, NOT in dunning. payment_status=PAID juz wyklucza dunning
      // (SCDUN-1: PAST_DUE/UNPAID -> IN_PROGRESS), ale to defense-in-depth (SCDUN-2):
      // konto w dunningu NIE moze dostac maila "odnowi sie za 7 dni".
      // cancel_at_period_end=true = anuluje na koniec okresu, nadal active (skip nizej).
      subscription_status: {
        notIn: [...renewalReminderExcludedStatuses],
      },
      current_period_end: {
        gte: renewalWindowStart,
        lte: renewalWindowEnd,
      },
      created_by_user: {
        is_active: true,
      },
    },
    select: {
      account_id: true,
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
    // DECISION (nie usuwaj tego komentarza):
    // orderBy current_period_end asc + SSOT cap (MAX_EMAILS_PER_SWEEP, nie literał 50) +
    // cap-hit warn — parytet z winback-deletion (I3). Bez orderBy LIMIT zwraca
    // niedeterministyczny podzbiór (physical order), więc przy >cap kont w oknie 6-8d ten
    // sam pierwszy-cap wygrywał każdy sweep, a pozostali byli TRWALE pozbawieni pre-charge
    // notice (okno 48h + dedup przez okres = nigdy niedogonieni). asc = najbliżsi obciążenia
    // pierwsi (drop trafia w tych z największym zapasem, nie tuż-przed-renewal). Warn robi
    // cichą utratę obserwowalną, zanim skala uderzy.
    orderBy: { current_period_end: 'asc' },
    take: EMAIL_LIFECYCLE_CONFIG.MAX_EMAILS_PER_SWEEP, // Safety cap per sweep
  });
};

/** Users from `userIds` already reminded in the current renewal period. */
export const fetchRenewalReminderSent = async (
  userIds: readonly string[],
  now: Date
): Promise<Set<string>> => {
  if (userIds.length === 0) {
    return new Set();
  }
  // 2. Idempotency: check who already received the reminder FOR THIS renewal period.
  //    A user gets at most 1 reminder per renewal period.
  //    We approximate "current period" as: sent within the last 25 days
  //    (renewal period is 30d; 25d lookback avoids double-send within same period).
  const periodLookbackDate = new Date(now.getTime() - 25 * MS_PER_DAY);
  const alreadySentLogs = await DB_CLIENT.use.eventLog.findMany({
    where: {
      event: APP_EVENTS.INFO.EMAIL.EMAIL_RENEWAL_REMINDER_7D_SENT,
      event_type: EventLogTypeValue.EMAIL,
      created_by_user_id: { in: [...userIds] },
      created_at: { gte: periodLookbackDate },
    },
    select: { created_by_user_id: true },
    take: userIds.length,
  });
  return new Set(alreadySentLogs.map(l => l.created_by_user_id));
};

/**
 * Send pre-renewal reminder emails (7 days before charge).
 *
 * Triggered from email lifecycle sweep (safeStep).
 * Returns number of emails sent.
 */
export const sendRenewalReminderEmails_IO = async (): Promise<number> => {
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

    // 2. Idempotency: at most one reminder per renewal period (see helper).
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

        // Skip cancelled subscriptions (cancel_at_period_end=true but not yet cancelled)
        // We still send the reminder — user should know they won't be charged since they
        // already cancelled. Actually: if cancel_at_period_end=true, they WON'T be charged.
        // DECISION: skip reminder for cancel_at_period_end=true accounts — it would be
        // misleading to say "you'll be charged" when they've already cancelled.
        if (account.cancel_at_period_end === true) {
          return 0;
        }

        // Dedup: skip if already sent this period
        const userId = account.created_by_user_id;
        if (alreadySent.has(userId)) {
          return 0;
        }

        // TRANSACTIONAL emails are NOT subject to frequency cap (exempt)
        // — per EMAIL_FREQUENCY_CAP.EXEMPT_CATEGORIES in email-schedule.config.ts

        const locale = getLocaleOrDefault(localeMap.get(userId) ?? 'pl');
        const displayName = account.created_by_user.name || '';
        // DECISION (nie usuwaj tego komentarza):
        // TRANSACTIONAL email = NIE oferujemy linku/headerów wypisu (parytet z
        // email-transactional.ts: `unsubscribeUrl=''` + `headers:{}`). Renewal-reminder
        // ma kategorię TRANSACTIONAL (email-schedule.config.ts) i processUnsubscribe_IO
        // odrzuca taki token (400 EMAIL_TRANSACTIONAL_NOT_UNSUBSCRIBABLE, PKE/UOKiK).
        // Wcześniej osadzaliśmy List-Unsubscribe + footer-link wskazujące na token
        // gwarantowanie zwracający 400/405 — złamany kontrakt consent-UX (email-newsletter-3).
        // Pusty unsubscribeUrl suppressuje footer-link w renderze (truthy-check), brak
        // headerów List-Unsubscribe* gdy transactional. Warunek na rule.category — jeśli
        // kategoria kiedyś zmieni się na non-TRANSACTIONAL, link wróci automatycznie.
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
          planName: getPlanDisplayName(account.pricing_plan),
          renewalDate: account.current_period_end
            ? formatEmailDate(account.current_period_end, locale)
            : '',
        };

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
            // No List-Unsubscribe* for TRANSACTIONAL (unsubscribeUrl=='' guards the
            // truthy build below) — see DECISION above (email-newsletter-3).
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
                currentPeriodEnd: account.current_period_end?.toISOString(),
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
