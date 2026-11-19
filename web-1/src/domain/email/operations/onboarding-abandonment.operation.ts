import { sendScheduledLifecycleEmail } from './scheduled-lifecycle.send';
/**
 * Onboarding abandonment recovery.
 *
 * Sweep: users who registered 24-48h ago and have neither account.
 * Skip a user who already has EMAIL_ONBOARDING_INCOMPLETE_24H_SENT. The log
 * write is awaited after accept, so a later sweep can see it. Two sends that
 * both pass the read before either write are not collapsed.
 * Category: TRIAL_SEQUENCE. Respects opt-out preferences.
 */

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { TIME } from '@kernel/application/constants.config';
import {
  ONBOARDING_ABANDONMENT_RULE,
  EMAIL_CATEGORY,
  EMAIL_LIFECYCLE_CONFIG,
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
import { Prisma } from '../../../prisma/js-client';
import {
  noPriorEmailAudit,
  usersWithEmailAudit,
} from './email-audit-dedup.query';

const MS_PER_HOUR = TIME.MS_PER_HOUR;

/**
 * Users in the 24-48 h window after signup who finished no onboarding.
 * Shared by the sweep and the admin queue preview (email-pipeline.query.ts),
 * which evaluates it at "now" and at "now + 24 h".
 */
export const queryOnboardingAbandonmentCandidates = async (now: Date) => {
  const minAge = new Date(
    now.getTime() - ONBOARDING_ABANDONMENT_RULE.triggerAfterHours * MS_PER_HOUR
  );
  const maxAge = new Date(
    now.getTime() -
      (ONBOARDING_ABANDONMENT_RULE.triggerAfterHours +
        ONBOARDING_ABANDONMENT_RULE.triggerWindowHours) *
        MS_PER_HOUR
  );

  const eligible = await DB_CLIENT.use.$queryRaw<
    Array<{ id: string }>
  >(Prisma.sql`
    SELECT u."id" FROM "users" u
     WHERE u."is_active" = true
       AND u."created_at" >= ${maxAge} AND u."created_at" <= ${minAge}
       AND NOT EXISTS (SELECT 1 FROM "StylistAccount" a WHERE a."created_by_user_id" = u."id")
       AND NOT EXISTS (SELECT 1 FROM "ClientAccount" c WHERE c."created_by_user_id" = u."id")
       AND ${noPriorEmailAudit(Prisma.sql`u."id"`, APP_EVENTS.INFO.EMAIL.EMAIL_ONBOARDING_INCOMPLETE_24H_SENT)}
     ORDER BY u."created_at" ASC, u."id" ASC
     LIMIT ${EMAIL_LIFECYCLE_CONFIG.MAX_EMAILS_PER_SWEEP}
  `);
  if (!eligible.length) {
    return [];
  }
  // 1. Find users who registered in the 24-48h window
  //    and completed NO onboarding of either type (never picked a role).
  //    User.createdAt is the Prisma field name (mapped from DB created_at).
  return DB_CLIENT.use.user.findMany({
    where: {
      id: { in: eligible.map(user => user.id) },
      is_active: true,
      createdAt: {
        gte: maxAge, // older bound: must be at most 48h old
        lte: minAge, // newer bound: must be at least 24h old
      },
      // DECISION: the predicate is "onboarding never completed", so it excludes BOTH paths:
      // stylist_account: null alone also matched users who finished CLIENT onboarding
      // (onboardAsClient_IO creates only client_account) and sent them a stylist nudge.
      stylist_account: null,
      client_account: null,
    },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
    },
    // DECISION: orderBy createdAt asc under the MAX_EMAILS_PER_SWEEP cap, as in
    // web-1/src/domain/email/operations/renewal-reminder.operation.ts (without orderBy the LIMIT
    // returns an arbitrary subset). Asc serves those closest to leaving the
    // 24-48 h window first.
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
};

/** Users from `userIds` who already have EMAIL_ONBOARDING_INCOMPLETE_24H_SENT. */
export const fetchOnboardingAbandonmentSent = async (
  userIds: readonly string[]
): Promise<Set<string>> => {
  return usersWithEmailAudit(
    userIds,
    APP_EVENTS.INFO.EMAIL.EMAIL_ONBOARDING_INCOMPLETE_24H_SENT
  );
};

/**
 * Send onboarding abandonment recovery emails.
 *
 * Triggered from email lifecycle sweep (safeStep).
 * Returns number of emails sent.
 */
export const sendOnboardingAbandonmentEmails_IO = async (
  sweepId?: string
): Promise<number> => {
  try {
    const candidates = await queryOnboardingAbandonmentCandidates(new Date());

    if (candidates.length === 0) {
      return 0;
    }

    if (candidates.length === EMAIL_LIFECYCLE_CONFIG.MAX_EMAILS_PER_SWEEP) {
      reportIssueBackend({
        namespace: 'ONBOARDING_ABANDONMENT_SWEEP_CAP_HIT',
        message: `Onboarding-abandonment sweep hit the per-sweep cap (${EMAIL_LIFECYCLE_CONFIG.MAX_EMAILS_PER_SWEEP}); abandoners beyond the cap in the 24-48h window are deferred and may fall out of the window before the next sweep`,
        payload: {},
        mode: 'warn',
      });
    }

    const userIds = candidates.map(u => u.id);

    // Skip users who already have EMAIL_ONBOARDING_INCOMPLETE_24H_SENT.
    const alreadySent = await fetchOnboardingAbandonmentSent(userIds);

    // 3. Batch-resolve locale via the canonical SSOT helper (eliminates the
    //    re-implemented distinct-no-take block; same query the inline version mirrored).
    //    Helper is fail-open (locale-query error → empty map → all users default 'pl')
    //    so a locale lookup hiccup cannot abort the whole abandonment sweep.
    const localeMap = await batchResolveLocales(userIds);

    // 4. Batch-resolve frequency counts
    const frequencyCountMap = await batchGetEmailFrequencyCounts_IO(userIds);

    // 5. Process with bounded concurrency
    const results = await runWithConcurrency(candidates, 5, async user => {
      try {
        // Dedup: skip if already sent
        if (alreadySent.has(user.id)) {
          return 0;
        }

        // Frequency cap — TRIAL_SEQUENCE is NOT exempt
        const emailCount = frequencyCountMap.get(user.id) ?? 0;
        if (!canSendEmailFromCache(emailCount, EMAIL_CATEGORY.TRIAL_SEQUENCE)) {
          return 0;
        }

        const locale = getLocaleOrDefault(localeMap.get(user.id) ?? 'pl');
        const displayName = user.name || '';
        const unsubscribeUrl = buildEmailUnsubscribeUrl(
          user.id,
          EMAIL_CATEGORY.TRIAL_SEQUENCE,
          locale
        );
        const appBaseUrl = buildFrontendBaseUrl();

        const vars: Record<string, string> = {
          displayName,
          appUrl: appBaseUrl,
        };

        const result = await sendScheduledLifecycleEmail({
          userId: user.id,
          accountId: user.id,
          email: user.email,
          family: 'onboarding-recovery',
          ruleId: ONBOARDING_ABANDONMENT_RULE.id,
          occurrence: `registration:${user.createdAt.toISOString()}`,
          templateId: ONBOARDING_ABANDONMENT_RULE.bodyTemplateId,
          subjectKey: ONBOARDING_ABANDONMENT_RULE.subjectKey,
          locale,
          category: ONBOARDING_ABANDONMENT_RULE.category,
          vars,
          unsubscribeUrl,
          ...(sweepId ? { sweepId } : {}),
          validate: async () => {
            const fresh = await DB_CLIENT.use.user.findUnique({
              where: { id: user.id },
              select: {
                stylist_account: { select: { account_id: true } },
                client_account: { select: { client_account_id: true } },
              },
            });
            return (
              fresh !== null && !fresh.stylist_account && !fresh.client_account
            );
          },
        });
        const sent = result.status === 'accepted';

        if (sent) {
          // DECISION: await the dedup write (same pattern as winback-dedup-await in
          // winback-deletion). The match window (24 h after + 24 h wide) is wider than the 6 h sweep
          // throttle, so a user matches ~4 sweeps; a fire-and-forget write could let sweep N+1 miss
          // it and send a second mail. recordAuditEvent_IO never throws; on failure the mail still
          // counts as sent (return 1), because a resend is worse than a missing audit row.
          try {
            await recordAuditEvent_IO({
              eventName:
                APP_EVENTS.INFO.EMAIL.EMAIL_ONBOARDING_INCOMPLETE_24H_SENT,
              user: { id: user.id },
              responseBody: {
                lifecycleMessageId: result.messageId,
                templateId: ONBOARDING_ABANDONMENT_RULE.bodyTemplateId,
                category: ONBOARDING_ABANDONMENT_RULE.category,
              },
            });
          } catch (auditErr) {
            reportIssueBackend({
              namespace: 'ONBOARDING_ABANDONMENT_DEDUP_WRITE_ERROR',
              message: `Onboarding abandonment email sent but dedup audit write threw for user ${user.id} — counted as sent to avoid resend`,
              payload: auditErr,
              mode: 'error',
            });
          }
          return 1;
        }
        return 0;
      } catch (err) {
        reportIssueBackend({
          namespace: 'ONBOARDING_ABANDONMENT_EMAIL_ERROR',
          message: `Failed to send onboarding abandonment email for user ${user.id}`,
          payload: err,
          mode: 'error',
        });
        return 0;
      }
    });

    return results.reduce<number>((sum, n) => sum + n, 0);
  } catch (error) {
    reportIssueBackend({
      namespace: 'ONBOARDING_ABANDONMENT_SWEEP_ERROR',
      message: 'sendOnboardingAbandonmentEmails_IO failed',
      payload: error,
      mode: 'error',
    });
    return 0;
  }
};
