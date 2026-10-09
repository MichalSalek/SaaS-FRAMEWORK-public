/**
 * Cancel sequence. Day 0 is the latest Stripe plan-change event to FREE.
 * D1 is transactional. D7 (first-month offer) and D30 are marketing.
 * Accounts still inside the post-trial window are left to D30/D37.
 */

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  CANCEL_EMAIL_SCHEDULE,
  EMAIL_CATEGORY,
  EMAIL_LIFECYCLE_CONFIG,
  EMAIL_SWEEP_TUNING,
  POST_TRIAL_AUDIENCE_WINDOW_DAYS,
} from '@kernel/domain/email/email-schedule.config';
import { TIME } from '@kernel/application/constants.config';
import {
  getPlanDisplayName,
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { getLocaleOrDefault } from '@kernel/domain/i18n/i18n.config';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import {
  EventLogTypeValue,
  SubscriptionStatusValue,
} from '@kernel/models/db_models.generated.dto';
import { DB_CLIENT } from '@app/db/db.client';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { reportIssueBackend } from '@app/debugger/error-handler';
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
  calculateCancelDay,
  cancelAnchorLookbackDays,
  eligibleCancelRules,
  isCancelSequenceAudience,
  isExcludedByPostTrialWindow,
  pendingCancelRules,
} from '@domain/email/cancel-audience.policy';
import { issueFirstMonthOffer_IO } from '@domain/email/email-offer.issuer';
import { formatEmailDateTime } from '@domain/email/email-date.format';

const PAID: ReadonlySet<string> = new Set([
  PricingPlanValue.PRO,
  PricingPlanValue.PRO_PLUS,
  PricingPlanValue.STUDIO,
]);

const CANCEL_TRIGGER_DAYS = CANCEL_EMAIL_SCHEDULE.map(rule => rule.triggerDay);

type CancelAnchor = {
  canceledAt: Date;
  oldPlan: PricingPlan;
};

/** Stylist accounts on FREE after a canceled subscription, among `userIds`. */
const queryCancelSequenceAccounts = (userIds: readonly string[], now: Date) => {
  const postTrialCutoff = new Date(
    now.getTime() - POST_TRIAL_AUDIENCE_WINDOW_DAYS * TIME.MS_PER_DAY
  );
  return DB_CLIENT.use.stylistAccount.findMany({
    where: {
      created_by_user_id: { in: [...userIds] },
      pricing_plan: PricingPlanValue.FREE,
      subscription_status: SubscriptionStatusValue.CANCELED,
      created_by_user: { is_active: true },
      // Mirrors isExcludedByPostTrialWindow: a trial that ended inside the
      // post-trial window belongs to the trial sequence (D30 / D37).
      OR: [
        { trial_ends_at: null },
        { trial_ends_at: { gt: now } },
        { trial_ends_at: { lt: postTrialCutoff } },
      ],
    },
    select: {
      account_id: true,
      display_name: true,
      trial_ends_at: true,
      pricing_plan: true,
      subscription_status: true,
      email_marketing: true,
      stripe_customer_id: true,
      created_by_user_id: true,
      created_by_user: {
        select: { email: true, name: true, is_active: true },
      },
      _count: { select: { gallery_record: true } },
    },
    // Stable selection under the per-sweep cap (guard
    // audit:email-sweep-orderby).
    orderBy: { account_id: 'asc' },
    take: EMAIL_LIFECYCLE_CONFIG.MAX_EMAILS_PER_SWEEP,
  });
};

type CancelSequenceAccount = Awaited<
  ReturnType<typeof queryCancelSequenceAccounts>
>[number];

export type CancelSequenceDue = {
  readonly ready: readonly CancelSequenceAccount[];
  readonly anchors: ReadonlyMap<string, CancelAnchor>;
  readonly sent: ReadonlyMap<string, ReadonlySet<string>>;
};

const NOTHING_DUE: CancelSequenceDue = {
  ready: [],
  anchors: new Map(),
  sent: new Map(),
};

const readAnchor = (payload: unknown, createdAt: Date): CancelAnchor | null => {
  if (payload == null || typeof payload !== 'object') {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const oldPlan = record['oldPricingPlan'];
  if (
    record['newPricingPlan'] !== PricingPlanValue.FREE ||
    record['source'] !== 'stripe' ||
    typeof oldPlan !== 'string' ||
    !PAID.has(oldPlan)
  ) {
    return null;
  }
  return { canceledAt: createdAt, oldPlan: oldPlan as PricingPlan };
};

/**
 * Who is due a cancel-sequence mail at `now`: the latest Stripe downgrade to
 * FREE as day 0, minus accounts with nothing left to send, minus trials still
 * inside the post-trial window. Shared by the sweep and the admin queue
 * preview (email-pipeline.query.ts), which evaluates it at "now" and
 * "now + 24 h"; the rules per account come from eligibleCancelRules.
 */
export const resolveCancelSequenceDue_IO = async (
  now: Date
): Promise<CancelSequenceDue> => {
  const since = new Date(
    now.getTime() -
      cancelAnchorLookbackDays(CANCEL_TRIGGER_DAYS) * TIME.MS_PER_DAY
  );

  // Day 0 lives only in EventLog, so the audience starts there: recent
  // plan changes, newest first (@@index([event, created_at])). Starting from
  // accounts meant every CANCELED + FREE row ever, capped at the same 50
  // oldest ids each sweep, so later cancellations were never mailed.
  const logs = await DB_CLIENT.use.eventLog.findMany({
    where: {
      event: APP_EVENTS.INFO.ADMIN.ADMIN_PRICING_PLAN_CHANGED,
      event_type: EventLogTypeValue.ACCOUNT,
      created_at: { gte: since },
    },
    orderBy: { created_at: 'desc' },
    select: {
      created_by_user_id: true,
      created_at: true,
      event_payload: true,
    },
    take: EMAIL_SWEEP_TUNING.MAX_EVENTS_PER_QUERY,
  });

  const anchors = new Map<string, CancelAnchor>();
  for (const log of logs) {
    if (anchors.has(log.created_by_user_id)) {
      continue;
    }
    const anchor = readAnchor(log.event_payload, log.created_at);
    if (anchor) {
      anchors.set(log.created_by_user_id, anchor);
    }
  }
  const dueIds = [...anchors]
    .filter(
      ([, anchor]) =>
        pendingCancelRules(
          CANCEL_EMAIL_SCHEDULE,
          calculateCancelDay(anchor.canceledAt, now),
          new Set()
        ).length > 0
    )
    .map(([userId]) => userId);
  if (dueIds.length === 0) {
    return NOTHING_DUE;
  }

  const sentLogs = await DB_CLIENT.use.eventLog.findMany({
    where: {
      created_by_user_id: { in: dueIds },
      event_type: EventLogTypeValue.EMAIL,
      event: {
        in: CANCEL_EMAIL_SCHEDULE.map(rule => rule.infoEvent),
      },
    },
    select: { created_by_user_id: true, event: true },
    take: Math.min(
      dueIds.length * CANCEL_EMAIL_SCHEDULE.length,
      EMAIL_SWEEP_TUNING.MAX_EVENTS_PER_QUERY
    ),
  });
  const sent = new Map<string, Set<string>>();
  for (const log of sentLogs) {
    const set = sent.get(log.created_by_user_id) ?? new Set<string>();
    set.add(log.event);
    sent.set(log.created_by_user_id, set);
  }
  // Only users with something left to send reach the capped account query,
  // so already-served rows cannot fill it.
  const pendingIds = dueIds.filter(userId => {
    const anchor = anchors.get(userId);
    return (
      anchor !== undefined &&
      pendingCancelRules(
        CANCEL_EMAIL_SCHEDULE,
        calculateCancelDay(anchor.canceledAt, now),
        sent.get(userId) ?? new Set<string>()
      ).length > 0
    );
  });
  if (pendingIds.length === 0) {
    return NOTHING_DUE;
  }

  const accounts = await queryCancelSequenceAccounts(pendingIds, now);

  const ready = accounts.filter(
    account =>
      isCancelSequenceAudience({
        userActive: account.created_by_user.is_active,
        subscriptionStatus: account.subscription_status,
        pricingPlan: account.pricing_plan,
        trialEndsAt: account.trial_ends_at,
      }) && !isExcludedByPostTrialWindow(account.trial_ends_at, now)
  );
  return { ready, anchors, sent };
};

export const sendCancelSequenceEmails_IO = async (): Promise<number> => {
  try {
    const now = new Date();
    const { ready, anchors, sent } = await resolveCancelSequenceDue_IO(now);
    if (ready.length === 0) {
      return 0;
    }

    const readyIds = ready.map(account => account.created_by_user_id);
    const [localeMap, frequencyCountMap] = await Promise.all([
      batchResolveLocales(readyIds),
      batchGetEmailFrequencyCounts_IO(readyIds),
    ]);

    const results = await runWithConcurrency(ready, 5, async account => {
      const userId = account.created_by_user_id;
      const email = account.created_by_user.email;
      const anchor = anchors.get(userId);
      if (!email || !anchor) {
        return 0;
      }
      const cancelDay = calculateCancelDay(anchor.canceledAt, now);
      // Local copy: the loop records what it sends so a second due rule in
      // the same run sees the first one as sent.
      const already = new Set(sent.get(userId) ?? []);
      const locale = getLocaleOrDefault(localeMap.get(userId) ?? 'pl');
      let localCount = 0;
      let sentCount = 0;

      for (const rule of eligibleCancelRules(
        CANCEL_EMAIL_SCHEDULE,
        cancelDay,
        already,
        account.email_marketing
      )) {
        if (already.has(rule.infoEvent)) {
          continue;
        }
        const emailCount = frequencyCountMap.get(userId) ?? 0;
        if (!canSendEmailFromCache(emailCount + localCount, rule.category)) {
          continue;
        }

        const issued =
          rule.bodyTemplateId === 'cancel-d7-winback'
            ? await issueFirstMonthOffer_IO({
                userId,
                templateId: rule.bodyTemplateId,
                infoEvent: rule.infoEvent,
                displayName:
                  account.display_name || account.created_by_user.name || '',
                stripeCustomerId: account.stripe_customer_id,
                applyToSubscriptionId: null,
              })
            : null;

        const vars: Record<string, string> = {
          displayName:
            account.display_name || account.created_by_user.name || '',
          planName: getPlanDisplayName(anchor.oldPlan),
          funnelPlanId: anchor.oldPlan,
          galleryCount: String(account._count.gallery_record),
          appUrl: buildFrontendBaseUrl(),
          ...(issued
            ? {
                offerCode: issued.code,
                offerExpiresAt: formatEmailDateTime(issued.expiresAt, locale),
              }
            : {}),
        };

        const unsubscribeUrl =
          rule.category === EMAIL_CATEGORY.TRANSACTIONAL
            ? ''
            : buildEmailUnsubscribeUrl(userId, rule.category, locale);
        const rendered = renderEmailTemplate(
          rule.bodyTemplateId,
          vars,
          locale,
          unsubscribeUrl,
          `email.cancel.${rule.id === 'CANCEL_D1' ? 'd1' : rule.id === 'CANCEL_D7_WINBACK' ? 'd7' : 'd30'}.subject`
        );
        const delivered = await withEmailDeliveryRetry(isFinalAttempt =>
          sendLifecycleEmail({
            to: email,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            templateId: rule.bodyTemplateId,
            category: rule.category,
            deadLetterOnFailure: isFinalAttempt,
            tags: [
              'lifecycle',
              rule.id.toLowerCase(),
              rule.category.toLowerCase(),
            ],
            headers: unsubscribeUrl
              ? {
                  'List-Unsubscribe': `<${unsubscribeUrl}>`,
                  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
                }
              : {},
          })
        );
        if (!delivered) {
          continue;
        }
        localCount += rule.category === EMAIL_CATEGORY.TRANSACTIONAL ? 0 : 1;
        sentCount += 1;
        already.add(rule.infoEvent);
        try {
          await recordAuditEvent_IO({
            eventName: rule.infoEvent as EVENT_INFO_TYPE,
            user: { id: userId },
            responseBody: {
              templateId: rule.bodyTemplateId,
              category: rule.category,
              cancelDay,
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
            namespace: 'CANCEL_SEQUENCE_DEDUP_WRITE_ERROR',
            message: `Cancel email sent but dedup write threw for ${account.account_id}`,
            payload: auditErr,
            mode: 'error',
          });
        }
      }
      return sentCount;
    });

    return results.reduce<number>((sum, n) => sum + n, 0);
  } catch (error) {
    reportIssueBackend({
      namespace: 'CANCEL_SEQUENCE_SWEEP_ERROR',
      message: 'sendCancelSequenceEmails_IO failed',
      payload: error,
      mode: 'error',
    });
    return 0;
  }
};
