import type Stripe from 'stripe';
import type { Prisma } from '../../../../prisma/js-client';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { writeRawEventLog_IO } from '@app/event-log/event-log.client';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { DB_CLIENT } from '@app/db/db.client';
import { findAccountByCustomerId } from '@app/stripe/webhooks/stripe-webhooks.db';
import { extractCustomerId } from '@app/stripe/webhooks/stripe-webhooks.utils';
import {
  emptyEffectsResult,
  type StripeHandlerResult,
} from '@app/stripe/webhooks/stripe-effects.types';
import { handleSubscriptionUpdated } from './subscription-lifecycle.handler';

/**
 * Handle customer.subscription.paused event
 */
export const handleSubscriptionPaused = async ({
  subscription,
  eventCreatedAt,
  prefetchedPlanId,
  tx,
}: {
  subscription: Stripe.Subscription;
  eventCreatedAt: Date;
  prefetchedPlanId?: string | null;
  tx?: Prisma.TransactionClient;
}): Promise<StripeHandlerResult> => {
  return await handleSubscriptionUpdated({
    subscription,
    eventCreatedAt,
    ...(prefetchedPlanId !== undefined && { prefetchedPlanId }),
    ...(tx && { tx }),
  });
};

/**
 * Handle customer.subscription.resumed event
 */
export const handleSubscriptionResumed = async ({
  subscription,
  eventCreatedAt,
  prefetchedPlanId,
  tx,
}: {
  subscription: Stripe.Subscription;
  eventCreatedAt: Date;
  prefetchedPlanId?: string | null;
  tx?: Prisma.TransactionClient;
}): Promise<StripeHandlerResult> => {
  return await handleSubscriptionUpdated({
    subscription,
    eventCreatedAt,
    ...(prefetchedPlanId !== undefined && { prefetchedPlanId }),
    ...(tx && { tx }),
  });
};

/**
 * Handle customer.subscription.trial_will_end event.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Records STRIPE_TRIAL_WILL_END (ACCOUNT, not EMAIL) and trial_reminder_sent.
 * Sends no email. D23/D29 in TRIAL_EMAIL_SCHEDULE are the reminder; this event
 * does not dedup those rules, so a send here would double-notify.
 */
export const handleSubscriptionTrialWillEnd = async ({
  subscription,
  tx,
}: {
  subscription: Stripe.Subscription;
  tx?: Prisma.TransactionClient;
}): Promise<StripeHandlerResult> => {
  const customerId = extractCustomerId({ customer: subscription.customer });
  if (!customerId) {
    reportIssueBackend({
      namespace: 'STRIPE_TRIAL_WILL_END',
      message: 'No customer ID in subscription',
      payload: { subscriptionId: subscription.id },
      mode: 'error',
    });
    return emptyEffectsResult();
  }

  const account = await findAccountByCustomerId(customerId, tx);
  if (!account) {
    return emptyEffectsResult();
  }

  await writeRawEventLog_IO({
    eventName: APP_EVENTS.INFO.ACCOUNT.STRIPE_TRIAL_WILL_END,
    eventLogType: EventLogTypeValue.ACCOUNT,
    eventPayloadToStringify: {
      accountId: account.account_id,
      subscriptionId: subscription.id,
      trialEnd: subscription.trial_end
        ? new Date(subscription.trial_end * 1000)
        : null,
    },
    meta: { created_by_user_id: account.created_by_user_id },
    ...(tx && { tx }),
  });

  // Set trial_reminder_sent flag
  await (tx ?? DB_CLIENT.use).stylistAccount.update({
    where: { account_id: account.account_id },
    data: { trial_reminder_sent: true },
  });

  reportIssueBackend({
    namespace: 'STRIPE_TRIAL_NOTIFICATION',
    message: 'Trial for account will end soon, reminder flag set',
    payload: {
      accountId: account.account_id,
      trialEnd: subscription.trial_end,
    },
    mode: 'info',
  });

  return emptyEffectsResult();
};
