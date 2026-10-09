/**
 * Admin email pipeline: a dry run of the lifecycle sweep.
 *
 * Answers "who gets which mail today and within 24 h, did the sweep run, and
 * are the first-month codes used" without sending anything. The queue is
 * computed by each sweep's own audience functions (trial sequence, onboarding
 * reminder, cancel sequence, renewal reminder, win-back D60), evaluated at
 * "now" and at "now + 24 h", so the preview cannot drift from what the sweep
 * decides. The weekly frequency cap and quiet hours apply at send time and are
 * not simulated. Dunning mails follow Stripe payment attempts (webhooks), not
 * the clock, so they are not in the queue.
 */

import type Stripe from 'stripe';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { TIME } from '@kernel/application/constants.config';
import {
  CANCEL_EMAIL_SCHEDULE,
  EMAIL_SWEEP_TUNING,
  ONBOARDING_ABANDONMENT_RULE,
  RENEWAL_REMINDER_RULE,
  WINBACK_DELETION_RULE,
} from '@kernel/domain/email/email-schedule.config';
import { EMAIL_OFFERS } from '@kernel/domain/stripe/stripe.config';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import type {
  AdminEmailOfferStats,
  AdminEmailPipelineSend,
  AdminGetEmailPipelineResponse,
} from '@kernel/models/admin/admin-mailing.dto';
import type { OperationResult } from '@kernel/application/result.types';
import { success } from '@kernel/application/result.types';
import type { AdminInsufficientPermissionsError } from '@kernel/domain/admin/admin-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import { resolveTrialEmails } from '@domain/email/trial-email.resolver';
import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { getStripe } from '@app/stripe/adapters/stripe.adapter';
import { STRIPE_PROJECT_ID } from '@app/stripe/stripe.types';
import {
  buildTrialSweepContext,
  queryTrialAccounts,
} from './trial-emails.operation';
import { toTrialAccountView } from './trial-account.send';
import {
  fetchOnboardingAbandonmentSent,
  queryOnboardingAbandonmentCandidates,
} from './onboarding-abandonment.operation';
import {
  fetchRenewalReminderSent,
  queryRenewalReminderCandidates,
} from './renewal-reminder.operation';
import {
  fetchWinbackDeletionSent,
  queryWinbackDeletionCandidates,
} from './winback-deletion.operation';
import { resolveCancelSequenceDue_IO } from './cancel-sequence.operation';
import {
  calculateCancelDay,
  eligibleCancelRules,
} from '@domain/email/cancel-audience.policy';

const WEEK_MS = 7 * TIME.MS_PER_DAY;

/** Stop reading promotion codes after this many (runaway guard). */
const OFFER_SCAN_CAP = 1000;

type Due = AdminEmailPipelineSend['due'];

const trialSendsAt = async (
  at: Date,
  due: Due
): Promise<AdminEmailPipelineSend[]> => {
  const sends: AdminEmailPipelineSend[] = [];
  let afterAccountId: string | null = null;
  for (let page = 0; page < EMAIL_SWEEP_TUNING.MAX_SWEEP_PAGES; page += 1) {
    const accounts = await queryTrialAccounts(at, afterAccountId);
    if (accounts.length === 0) {
      break;
    }
    const context = await buildTrialSweepContext(accounts);
    for (const account of accounts) {
      const { prefs, sentEvents, accountWithStats } = toTrialAccountView(
        account,
        context
      );
      for (const rule of resolveTrialEmails(
        accountWithStats,
        sentEvents,
        prefs,
        at
      )) {
        sends.push({
          userId: account.created_by_user_id,
          email: account.created_by_user.email,
          ruleId: rule.id,
          infoEvent: rule.infoEvent,
          templateId: rule.bodyTemplateId,
          due,
        });
      }
    }
    const last = accounts[accounts.length - 1];
    if (last === undefined) {
      break;
    }
    afterAccountId = last.account_id;
  }
  return sends;
};

const onboardingSendsAt = async (
  at: Date,
  due: Due
): Promise<AdminEmailPipelineSend[]> => {
  const candidates = await queryOnboardingAbandonmentCandidates(at);
  const sent = await fetchOnboardingAbandonmentSent(
    candidates.map(user => user.id)
  );
  return candidates
    .filter(user => !sent.has(user.id))
    .map(user => ({
      userId: user.id,
      email: user.email,
      ruleId: ONBOARDING_ABANDONMENT_RULE.id,
      infoEvent: ONBOARDING_ABANDONMENT_RULE.infoEvent,
      templateId: ONBOARDING_ABANDONMENT_RULE.bodyTemplateId,
      due,
    }));
};

const cancelSendsAt = async (
  at: Date,
  due: Due
): Promise<AdminEmailPipelineSend[]> => {
  const { ready, anchors, sent } = await resolveCancelSequenceDue_IO(at);
  return ready.flatMap(account => {
    const anchor = anchors.get(account.created_by_user_id);
    if (!anchor || !account.created_by_user.email) {
      return [];
    }
    return eligibleCancelRules(
      CANCEL_EMAIL_SCHEDULE,
      calculateCancelDay(anchor.canceledAt, at),
      sent.get(account.created_by_user_id) ?? new Set<string>(),
      account.email_marketing
    ).map(rule => ({
      userId: account.created_by_user_id,
      email: account.created_by_user.email,
      ruleId: rule.id,
      infoEvent: rule.infoEvent,
      templateId: rule.bodyTemplateId,
      due,
    }));
  });
};

const renewalSendsAt = async (
  at: Date,
  due: Due
): Promise<AdminEmailPipelineSend[]> => {
  const accounts = await queryRenewalReminderCandidates(at);
  const sent = await fetchRenewalReminderSent(
    accounts.map(account => account.created_by_user_id),
    at
  );
  // Same skips as the sweep: no address, cancel at period end, already sent.
  return accounts
    .filter(
      account =>
        Boolean(account.created_by_user.email) &&
        account.cancel_at_period_end !== true &&
        !sent.has(account.created_by_user_id)
    )
    .map(account => ({
      userId: account.created_by_user_id,
      email: account.created_by_user.email,
      ruleId: RENEWAL_REMINDER_RULE.id,
      infoEvent: RENEWAL_REMINDER_RULE.infoEvent,
      templateId: RENEWAL_REMINDER_RULE.bodyTemplateId,
      due,
    }));
};

const winbackSendsAt = async (
  at: Date,
  due: Due
): Promise<AdminEmailPipelineSend[]> => {
  const candidates = await queryWinbackDeletionCandidates(at);
  const sent = await fetchWinbackDeletionSent(candidates.map(user => user.id));
  return candidates
    .filter(user => Boolean(user.email) && !sent.has(user.id))
    .map(user => ({
      userId: user.id,
      email: user.email,
      ruleId: WINBACK_DELETION_RULE.id,
      infoEvent: WINBACK_DELETION_RULE.infoEvent,
      templateId: WINBACK_DELETION_RULE.bodyTemplateId,
      due,
    }));
};

/**
 * Every sweep-driven mail due at `at`. Sequential on purpose: each source
 * batches its own lookups, and running them at once would only compete for
 * the pool.
 */
const sendsAt = async (
  at: Date,
  due: Due
): Promise<AdminEmailPipelineSend[]> => [
  ...(await trialSendsAt(at, due)),
  ...(await onboardingSendsAt(at, due)),
  ...(await cancelSendsAt(at, due)),
  ...(await renewalSendsAt(at, due)),
  ...(await winbackSendsAt(at, due)),
];

/**
 * Codes on the Nailfolio first-month coupon, stamped with our project id.
 * Null when Stripe cannot be read, so the
 * rest of the panel still renders.
 */
const readOfferStats_IO = async (
  now: Date
): Promise<AdminEmailOfferStats | null> => {
  try {
    const stats: AdminEmailOfferStats = { issued: 0, redeemed: 0, active: 0 };
    let scanned = 0;
    const params: Stripe.PromotionCodeListParams = {
      coupon: EMAIL_OFFERS.FIRST_MONTH.couponId,
      limit: 100,
    };
    for await (const promo of getStripe().promotionCodes.list(params)) {
      scanned += 1;
      if (scanned > OFFER_SCAN_CAP) {
        break;
      }
      if (promo.metadata?.['projectId'] !== STRIPE_PROJECT_ID) {
        continue;
      }
      stats.issued += 1;
      if (promo.times_redeemed > 0) {
        stats.redeemed += 1;
      } else if (
        promo.active &&
        (promo.expires_at === null || promo.expires_at * 1000 > now.getTime())
      ) {
        stats.active += 1;
      }
    }
    return stats;
  } catch (error: unknown) {
    reportIssueBackend({
      namespace: 'ADMIN_EMAIL_PIPELINE_OFFERS',
      message: 'Promotion codes could not be read from Stripe',
      payload: {
        error: error instanceof Error ? error.message : String(error),
      },
      mode: 'warn',
    });
    return null;
  }
};

/** `responseBody.emailsSent` of the sweep audit row, when readable. */
export const readEmailsSent = (payload: unknown): number | null => {
  if (payload === null || typeof payload !== 'object') {
    return null;
  }
  const body = (payload as Record<string, unknown>)['responseBody'];
  if (body === null || typeof body !== 'object') {
    return null;
  }
  const sent = (body as Record<string, unknown>)['emailsSent'];
  return typeof sent === 'number' ? sent : null;
};

const sendKey = (send: AdminEmailPipelineSend): string =>
  `${send.userId}:${send.ruleId}`;

/**
 * Today's sends, then tomorrow's. A rule still inside its catch-up window
 * tomorrow is already due today; it is listed once, under the earlier day.
 */
export const mergePipelineQueue = (
  today: readonly AdminEmailPipelineSend[],
  tomorrow: readonly AdminEmailPipelineSend[]
): AdminEmailPipelineSend[] => {
  const dueToday = new Set(today.map(sendKey));
  return [...today, ...tomorrow.filter(send => !dueToday.has(sendKey(send)))];
};

/**
 * The newest sweep audit row: the only durable evidence that the lifecycle
 * sweep runs at all (see the DECISION in email-lifecycle.orchestrator.ts).
 * Shared by the pipeline panel and by the admin badge `email_sweep_issues`.
 */
export const fetchLastEmailSweep = () =>
  DB_CLIENT.use.eventLog.findFirst({
    where: {
      event: APP_EVENTS.INFO.EMAIL.EMAIL_SWEEP_COMPLETED,
      event_type: EventLogTypeValue.EMAIL,
    },
    orderBy: { created_at: 'desc' },
    select: { created_at: true, event_payload: true },
  });

export const adminGetEmailPipeline_IO = async ({
  currentUser,
}: {
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<
  OperationResult<
    AdminGetEmailPipelineResponse,
    AdminInsufficientPermissionsError | DatabaseError
  >
> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  const now = new Date();
  const tomorrow = new Date(now.getTime() + TIME.MS_PER_DAY);

  try {
    const [lastSweep, sweepsLast7Days, offers] = await Promise.all([
      fetchLastEmailSweep(),
      DB_CLIENT.use.eventLog.count({
        where: {
          event: APP_EVENTS.INFO.EMAIL.EMAIL_SWEEP_COMPLETED,
          event_type: EventLogTypeValue.EMAIL,
          created_at: { gte: new Date(now.getTime() - WEEK_MS) },
        },
      }),
      readOfferStats_IO(now),
    ]);

    const today = await sendsAt(now, 'today');
    const nextDay = await sendsAt(tomorrow, 'tomorrow');

    return success({
      lastSweepAt: lastSweep?.created_at.toISOString() ?? null,
      lastSweepEmailsSent: readEmailsSent(lastSweep?.event_payload),
      sweepsLast7Days,
      queue: mergePipelineQueue(today, nextDay),
      offers,
    });
  } catch (error) {
    return databaseFailure('adminGetEmailPipeline', error);
  }
};
