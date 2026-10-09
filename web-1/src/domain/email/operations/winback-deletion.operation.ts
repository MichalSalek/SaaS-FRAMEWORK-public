/**
 * Win-back D60 — Account Deletion Recovery Operation
 *
 * Sweep step: find soft-deleted accounts with recovery_available=true whose
 * deleted_at is ~60 days ago (59.5-60.5d window per WINBACK_DELETION_RULE).
 * Sends a single win-back email per user (lifetime dedup).
 *
 * Idempotency: EventLog EMAIL_WINBACK_DELETION_D60_SENT dedup (lifetime).
 *   The dedup write is on the critical path (awaited before a send is counted) so
 *   a later throttled sweep cannot read a not-yet-committed log and double-send.
 *
 * Category: MARKETING — respects email_marketing opt-out preference (gated in
 * the query: only users whose stylist_account has email_marketing=true) and the
 * weekly frequency cap. See DECISION (winback-marketing-optout) on the query.
 *
 * Context: pre-launch zero deleted accounts → no sends until post-launch.
 * Code is production-ready now per task spec.
 */

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { TIME } from '@kernel/application/constants.config';
import {
  WINBACK_DELETION_RULE,
  EMAIL_CATEGORY,
} from '@kernel/domain/email/email-schedule.config';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import { DB_CLIENT } from '@app/db/db.client';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { getLocaleOrDefault } from '@kernel/domain/i18n/i18n.config';
import { renderEmailTemplate } from '@app/email-handler/email-template.renderer';
import { sendLifecycleEmail } from '@app/email-handler/email-transport';
import { withEmailDeliveryRetry } from '@app/email-handler/email-retry.utils';
import { buildEmailUnsubscribeUrl } from '@app/email-handler/email-unsubscribe.url';
import { buildFrontendBaseUrl } from '@app/environment/environment.utils.api';
import { runWithConcurrency } from '@app/utils/concurrency.utils';
import {
  batchGetEmailFrequencyCounts_IO,
  canSendEmailFromCache,
} from '@app/email-handler/lifecycle/email-frequency.guard';
import { batchResolveLocales } from '@app/email-handler/lifecycle/email-locale-batch.resolver';
import {
  getPlanDisplayName,
  PricingPlanValue,
} from '@kernel/domain/pricing/pricing.config';
import { issueFirstMonthOffer_IO } from '@domain/email/email-offer.issuer';
import { formatEmailDateTime } from '@domain/email/email-date.format';
import { resolveNamedPlan } from '@domain/email/email-personalization.resolver';

const MS_PER_DAY = TIME.MS_PER_DAY;

// Per-sweep safety cap. Higher than the lifecycle MAX_EMAILS_PER_SWEEP (50) because
// a mass-deletion ~60d ago could surface many candidates in a single 24h window, and
// dropping any is TERMINAL (window is 59.5-60.5d + lifetime dedup → the email is lost
// forever). With orderBy deleted_at asc we process the users closest to leaving the
// window first; if the cap is still hit we emit a warn so it is observable (I3).
const WINBACK_SWEEP_CAP = 200;

/**
 * Soft-deleted stylists ~60 days after deletion, still recoverable, with
 * marketing consent. Shared by the sweep and the admin queue preview
 * (email-pipeline.query.ts), which evaluates it at "now" and "now + 24 h".
 */
export const queryWinbackDeletionCandidates = (now: Date) => {
  // Target window: deleted_at is 59.5-60.5d ago
  // (triggerDaysAfterDeletion=60, triggerWindowHours=24 → ±12h = ±0.5d)
  const windowHalfMs =
    (WINBACK_DELETION_RULE.triggerWindowHours / 2) * (MS_PER_DAY / 24);
  const targetMs = WINBACK_DELETION_RULE.triggerDaysAfterDeletion * MS_PER_DAY;
  const deletionWindowStart = new Date(now.getTime() - targetMs - windowHalfMs);
  const deletionWindowEnd = new Date(now.getTime() - targetMs + windowHalfMs);

  // 1. Find soft-deleted accounts still in recovery window, deleted ~60d ago.
  //    is_active=false: soft-deleted (DOMAIN_SSOT §13.1 Model A).
  //    recovery_available=true: not yet MOVE'd (recovery window open, <90d).
  //    deleted_at in 59.5-60.5d window.
  //
  // DECISION (winback-marketing-optout, nie usuwaj tego komentarza):
  // Win-back jest kategorii MARKETING → MUSI respektować opt-out tak samo jak
  // jedyny inny MARKETING-mail (TRIAL_D37_WINBACK), gdzie resolver pomija usera
  // gdy `isOptedOut(MARKETING)` == `prefs.marketing === false`. Autorytatywne
  // źródło opt-outu to typed boolean `StylistAccount.email_marketing`
  // (PRMA Phase 2; trial-emails.operation.ts czyta dokładnie to pole → prefs.marketing).
  // Bramkujemy w query: `stylist_account: { email_marketing: true }`.
  //   • email_marketing=false  → user wypisał się z MARKETING → POMIŃ (consent).
  //   • brak stylist_account (KLIENTKA) → POMIŃ. ClientAccount NIE MA żadnego pola
  //     marketing-preference (schema.prisma: brak email_marketing/email_preferences),
  //     więc nie istnieje zgoda marketing-on dla klientek → consent-safe default =
  //     nie wysyłamy. Win-back D60 jest i tak ofertą reaktywacji subskrypcji —
  //     kierowany do stylistek, nie klientek.
  // Mail niesie kod 20% tylko wtedy, gdy Stripe go utworzy.
  // To gate jednocześnie wymaga istnienia stylist_account (relacja musi matchować),
  // więc spełnia oba warunki jednym filtrem (parytet z `where: stylist_account`
  // semantyki Prismy: to-one relation filter = relacja istnieje I spełnia predykat).
  return DB_CLIENT.use.user.findMany({
    where: {
      is_active: false,
      recovery_available: true,
      deleted_at: {
        gte: deletionWindowStart,
        lte: deletionWindowEnd,
      },
      stylist_account: {
        email_marketing: true,
      },
    },
    select: {
      id: true,
      email: true,
      name: true,
      deleted_at: true,
      stylist_account: {
        select: {
          stripe_customer_id: true,
          pricing_plan: true,
          display_name: true,
        },
      },
    },
    // Process users closest to the end of the 59.5-60.5d window first (oldest deleted_at)
    // so edge users are never the ones dropped if the cap is hit (I3).
    orderBy: { deleted_at: 'asc' },
    take: WINBACK_SWEEP_CAP,
  });
};

/** Users from `userIds` who already got the win-back mail (lifetime dedup). */
export const fetchWinbackDeletionSent = async (
  userIds: readonly string[]
): Promise<Set<string>> => {
  if (userIds.length === 0) {
    return new Set();
  }
  // 2. Batch dedup: lifetime — one win-back per user ever (not per deletion period).
  //    A user should never be deleted twice while using this rule; lifetime dedup is safe.
  const alreadySentLogs = await DB_CLIENT.use.eventLog.findMany({
    where: {
      event: APP_EVENTS.INFO.EMAIL.EMAIL_WINBACK_DELETION_D60_SENT,
      event_type: EventLogTypeValue.EMAIL,
      created_by_user_id: { in: [...userIds] },
    },
    select: { created_by_user_id: true },
    take: userIds.length,
  });
  return new Set(alreadySentLogs.map(l => l.created_by_user_id));
};

/**
 * Send win-back D60 emails to soft-deleted users still in recovery window.
 *
 * Triggered from email lifecycle sweep (safeStep).
 * Returns number of emails sent.
 */
export const sendWinbackDeletionEmails_IO = async (): Promise<number> => {
  try {
    const now = new Date();

    const candidates = await queryWinbackDeletionCandidates(now);

    if (candidates.length === 0) {
      return 0;
    }

    // Cap likely hit → some in-window users may be silently deferred to the next sweep
    // (and could fall out of the 59.5-60.5d window before then). Make it observable (I3).
    if (candidates.length === WINBACK_SWEEP_CAP) {
      reportIssueBackend({
        namespace: 'WINBACK_DELETION_SWEEP_CAP_HIT',
        message: `Win-back D60 sweep hit the per-sweep cap (${WINBACK_SWEEP_CAP}); excess in-window users deferred and may fall out of the 59.5-60.5d window before the next sweep`,
        payload: { cap: WINBACK_SWEEP_CAP },
        mode: 'warn',
      });
    }

    const userIds = candidates.map(u => u.id);

    // 2. Batch dedup: lifetime, one win-back per user ever (see helper).
    const alreadySent = await fetchWinbackDeletionSent(userIds);

    // 3. Batch-resolve locale via the canonical SSOT helper (eliminates the
    //    re-implemented distinct-no-take block; same query the inline version mirrored).
    //    Helper is fail-open (locale-query error → empty map → all users default 'pl')
    //    so a locale lookup hiccup cannot abort the whole win-back sweep.
    const localeMap = await batchResolveLocales(userIds);

    // 4. Batch-resolve frequency counts (MARKETING is NOT exempt from cap)
    const frequencyCountMap = await batchGetEmailFrequencyCounts_IO(userIds);

    // 5. Process with bounded concurrency
    const results = await runWithConcurrency(candidates, 5, async user => {
      try {
        // Dedup: skip if already sent (lifetime)
        if (alreadySent.has(user.id)) {
          return 0;
        }

        // Frequency cap — MARKETING is NOT exempt
        const emailCount = frequencyCountMap.get(user.id) ?? 0;
        if (!canSendEmailFromCache(emailCount, EMAIL_CATEGORY.MARKETING)) {
          return 0;
        }

        const locale = getLocaleOrDefault(localeMap.get(user.id) ?? 'pl');
        const displayName = user.name || '';
        const unsubscribeUrl = buildEmailUnsubscribeUrl(
          user.id,
          WINBACK_DELETION_RULE.category,
          locale
        );
        const appBaseUrl = buildFrontendBaseUrl();

        const stylist = user.stylist_account;
        const issued = await issueFirstMonthOffer_IO({
          userId: user.id,
          templateId: WINBACK_DELETION_RULE.bodyTemplateId,
          infoEvent: APP_EVENTS.INFO.EMAIL.EMAIL_WINBACK_DELETION_D60_SENT,
          displayName,
          stripeCustomerId: stylist?.stripe_customer_id ?? null,
          applyToSubscriptionId: null,
        });
        const namedPlan = resolveNamedPlan(
          { pricing_plan: stylist?.pricing_plan ?? PricingPlanValue.FREE },
          {}
        );
        const vars: Record<string, string> = {
          displayName,
          appUrl: appBaseUrl,
          planName: getPlanDisplayName(namedPlan),
          funnelPlanId: namedPlan,
          ...(issued
            ? {
                offerCode: issued.code,
                offerExpiresAt: formatEmailDateTime(issued.expiresAt, locale),
              }
            : {}),
        };

        const rendered = renderEmailTemplate(
          WINBACK_DELETION_RULE.bodyTemplateId,
          vars,
          locale,
          unsubscribeUrl,
          WINBACK_DELETION_RULE.subjectKey
        );

        const sent = await withEmailDeliveryRetry(isFinalAttempt =>
          sendLifecycleEmail({
            to: user.email,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            templateId: WINBACK_DELETION_RULE.bodyTemplateId,
            category: WINBACK_DELETION_RULE.category,
            // Dead-letter exactly once per incident (final retry attempt only)
            deadLetterOnFailure: isFinalAttempt,
            tags: [
              'lifecycle',
              WINBACK_DELETION_RULE.id.toLowerCase(),
              WINBACK_DELETION_RULE.category.toLowerCase(),
            ],
            headers: {
              'List-Unsubscribe': `<${unsubscribeUrl}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          })
        );

        if (sent) {
          // I2: dedup write is on the CRITICAL PATH (awaited) — NOT fire-and-forget.
          // The send window (±12h = 24h) is wider than SWEEP_THROTTLE_MS (6h), so a
          // user matches the query in ~4 consecutive sweeps; the EventLog dedup set is
          // the ONLY guard against re-sending this lifetime-once MARKETING email.
          // If we returned before the write committed, sweep N+1 (6h later) could read
          // EventLog before sweep N's write landed → a SECOND win-back. Awaiting closes
          // that race (unlike renewal-reminder, which has a 25-day lookback inside a
          // 30-day period absorbing the same skew — win-back has no such slack).
          //
          // DECISION (winback-dedup-await, nie usuwaj tego komentarza):
          // recordAuditEvent_IO swallows all errors internally (returns undefined on
          // failure or policy-skip; it never throws). On undefined the email is ALREADY
          // sent, so we still count it as sent (return 1): returning 0 would only cause
          // a resend on the next sweep — strictly worse than a missing audit row for a
          // lifetime-once marketing email. The try/catch is defense-in-depth in case the
          // wrapper ever starts throwing; we log but do not flip an already-sent email
          // to a resend.
          try {
            await recordAuditEvent_IO({
              eventName: APP_EVENTS.INFO.EMAIL.EMAIL_WINBACK_DELETION_D60_SENT,
              user: { id: user.id },
              responseBody: {
                templateId: WINBACK_DELETION_RULE.bodyTemplateId,
                category: WINBACK_DELETION_RULE.category,
                deletedAt: user.deleted_at?.toISOString(),
                ...(issued
                  ? {
                      promotionCodeId: issued.promotionCodeId,
                      promotionCode: issued.code,
                      offerExpiresAt: issued.expiresAt.toISOString(),
                      offerApplied: issued.applied,
                    }
                  : {}),
              },
            });
          } catch (auditErr) {
            reportIssueBackend({
              namespace: 'WINBACK_DELETION_DEDUP_WRITE_ERROR',
              message: `Win-back D60 email sent but dedup audit write threw for user ${user.id} — counted as sent to avoid resend`,
              payload: auditErr,
              mode: 'error',
            });
          }
          return 1;
        }
        return 0;
      } catch (err) {
        reportIssueBackend({
          namespace: 'WINBACK_DELETION_EMAIL_ERROR',
          message: `Failed to send win-back deletion email for user ${user.id}`,
          payload: err,
          mode: 'error',
        });
        return 0;
      }
    });

    return results.reduce<number>((sum, n) => sum + n, 0);
  } catch (error) {
    reportIssueBackend({
      namespace: 'WINBACK_DELETION_SWEEP_ERROR',
      message: 'sendWinbackDeletionEmails_IO failed',
      payload: error,
      mode: 'error',
    });
    return 0;
  }
};
