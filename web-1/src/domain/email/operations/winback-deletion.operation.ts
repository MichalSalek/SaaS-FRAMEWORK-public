import { sendScheduledLifecycleEmail } from './scheduled-lifecycle.send';
/**
 * Win-back around day 60 for soft-deleted accounts that can still be recovered.
 * One marketing mail per user: the EMAIL_WINBACK_DELETION_D60_SENT EventLog
 * write is awaited before a send is counted, so a later sweep does not read a
 * missing row and send a second mail. Opt-out and the weekly cap are applied
 * on the query (email_marketing=true). See DECISION winback-marketing-optout.
 */

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { TIME } from '@kernel/application/constants.config';
import {
  WINBACK_DELETION_RULE,
  EMAIL_CATEGORY,
} from '@kernel/domain/email/email-schedule.config';
import { DB_CLIENT } from '@app/db/db.client';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { getLocaleOrDefault } from '@kernel/domain/i18n/i18n.config';
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
import { Prisma } from '../../../prisma/js-client';
import {
  noPriorEmailAudit,
  usersWithEmailAudit,
} from './email-audit-dedup.query';

const MS_PER_DAY = TIME.MS_PER_DAY;

const WINBACK_SWEEP_CAP = 200;

/**
 * Soft-deleted stylists ~60 days after deletion, still recoverable, with
 * marketing consent. Shared by the sweep and the admin queue preview
 * (email-pipeline.query.ts), which evaluates it at "now" and "now + 24 h".
 */
export const queryWinbackDeletionCandidates = async (now: Date) => {
  // Target window: deleted_at is 59.5-60.5d ago
  // (triggerDaysAfterDeletion=60, triggerWindowHours=24 → ±12h = ±0.5d)
  const windowHalfMs =
    (WINBACK_DELETION_RULE.triggerWindowHours / 2) * (MS_PER_DAY / 24);
  const targetMs = WINBACK_DELETION_RULE.triggerDaysAfterDeletion * MS_PER_DAY;
  const deletionWindowStart = new Date(now.getTime() - targetMs - windowHalfMs);
  const deletionWindowEnd = new Date(now.getTime() - targetMs + windowHalfMs);

  const eligible = await DB_CLIENT.use.$queryRaw<
    Array<{ id: string }>
  >(Prisma.sql`
    SELECT u."id" FROM "users" u
      JOIN "StylistAccount" a ON a."created_by_user_id" = u."id"
     WHERE u."is_active" = false AND u."recovery_available" = true
       AND u."deleted_at" >= ${deletionWindowStart}
       AND u."deleted_at" <= ${deletionWindowEnd}
       AND a."email_marketing" = true
       AND ${noPriorEmailAudit(Prisma.sql`u."id"`, APP_EVENTS.INFO.EMAIL.EMAIL_WINBACK_DELETION_D60_SENT)}
     ORDER BY u."deleted_at" ASC, u."id" ASC
     LIMIT ${WINBACK_SWEEP_CAP}
  `);
  if (!eligible.length) {
    return [];
  }

  // 1. Find soft-deleted accounts still in recovery window, deleted ~60d ago.
  //    is_active=false: soft-deleted (DOMAIN_SSOT §13.1 Model A).
  //    recovery_available=true: not yet MOVE'd (recovery window open, <90d).
  //    deleted_at in 59.5-60.5d window.
  //
  // DECISION: winback-marketing-optout. Win-back is MARKETING, so it honours the opt-out like
  // TRIAL_D37_WINBACK; the authoritative source is the typed StylistAccount.email_marketing. The
  // to-one filter `stylist_account: { email_marketing: true }` also requires a stylist account:
  // clients have no marketing preference at all, so the consent-safe default is not to send. The
  // mail carries a 20% code only when Stripe creates one.
  return DB_CLIENT.use.user.findMany({
    where: {
      id: { in: eligible.map(user => user.id) },
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
          account_id: true,
          stripe_customer_id: true,
          pricing_plan: true,
          display_name: true,
        },
      },
    },
    // Process users closest to the end of the 59.5-60.5d window first (oldest deleted_at)
    // so edge users are never the ones dropped if the cap is hit (I3).
    orderBy: [{ deleted_at: 'asc' }, { id: 'asc' }],
  });
};

/** Users from `userIds` who already got the win-back mail (lifetime dedup). */
export const fetchWinbackDeletionSent = async (
  userIds: readonly string[]
): Promise<Set<string>> => {
  // 2. Batch dedup: lifetime — one win-back per user ever (not per deletion period).
  //    A user should never be deleted twice while using this rule; lifetime dedup is safe.
  return usersWithEmailAudit(
    userIds,
    APP_EVENTS.INFO.EMAIL.EMAIL_WINBACK_DELETION_D60_SENT
  );
};

/**
 * Send win-back D60 emails to soft-deleted users still in recovery window.
 *
 * Triggered from email lifecycle sweep (safeStep).
 * Returns number of emails sent.
 */
export const sendWinbackDeletionEmails_IO = async (
  sweepId?: string
): Promise<number> => {
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

        const result = await sendScheduledLifecycleEmail({
          userId: user.id,
          accountId: stylist?.account_id ?? user.id,
          email: user.email,
          family: 'winback',
          ruleId: WINBACK_DELETION_RULE.id,
          occurrence: `deletion:${user.deleted_at?.toISOString()}`,
          templateId: WINBACK_DELETION_RULE.bodyTemplateId,
          subjectKey: WINBACK_DELETION_RULE.subjectKey,
          locale,
          category: WINBACK_DELETION_RULE.category,
          vars,
          unsubscribeUrl,
          allowDeleted: true,
          ...(sweepId ? { sweepId } : {}),
          validate: async () => {
            const fresh = await DB_CLIENT.use.user.findUnique({
              where: { id: user.id },
              select: { deleted_at: true, recovery_available: true },
            });
            return (
              fresh?.deleted_at?.getTime() === user.deleted_at?.getTime() &&
              fresh?.recovery_available === true
            );
          },
        });
        const sent = result.status === 'accepted';

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
          // DECISION: winback-dedup-await. recordAuditEvent_IO never throws (undefined on failure or
          // policy skip). The email is already sent, so it still counts as sent (return 1):
          // returning 0 would resend a lifetime-once marketing email on the next sweep, which is
          // worse than a missing audit row. The try/catch is defense in depth only.
          try {
            await recordAuditEvent_IO({
              eventName: APP_EVENTS.INFO.EMAIL.EMAIL_WINBACK_DELETION_D60_SENT,
              user: { id: user.id },
              responseBody: {
                lifecycleMessageId: result.messageId,
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
