import type Stripe from 'stripe';
import { DB_CLIENT } from '@app/db/db.client';
import {
  success,
  failure,
  type OperationResult,
} from '@kernel/application/result.types';
import type {
  AccountNotFoundError,
  DatabaseError,
} from '@kernel/application/common-errors.types';
import type { AccountStripeError } from '@kernel/domain/user-and-account/account-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { getOrCreateStripeCustomer } from '@app/stripe/customer.operations';
import { getStripe } from '@app/stripe/adapters/stripe.adapter';
import { ENV_VARS } from '@app/environment/environment.config';
import { buildPortalSessionParams } from '@app/stripe/portal-session';
import { isScopedToNailfolio } from '@app/stripe/stripe.config';

export const createBillingPortalSession_IO = async ({
  userId,
  purpose = 'manage',
  locale = 'pl',
}: {
  userId: string;
  purpose?: 'manage' | 'cancel';
  locale?: 'pl' | 'en' | 'de';
}): Promise<
  OperationResult<
    { portalUrl: string; portalSessionId: string },
    AccountNotFoundError | AccountStripeError | DatabaseError
  >
> => {
  let user;
  try {
    user = await DB_CLIENT.use.user.findUnique({
      where: { id: userId },
      select: {
        // No user.id here — billing-portal uses only email + account_id (unlike the
        // hosted/embedded creators, which need user.id.toString() for client_reference_id).
        email: true,
        stylist_account: {
          select: { account_id: true, subscription_id: true },
        },
      },
    });
  } catch (error) {
    return databaseFailure('createBillingPortalSession:fetchUser', error);
  }

  if (!user?.stylist_account) {
    return failure({ type: 'ACCOUNT_NOT_FOUND', accountId: userId });
  }

  let stripeCustomerId: string;
  try {
    stripeCustomerId = await getOrCreateStripeCustomer({
      userEmail: user.email,
      accountId: user.stylist_account.account_id,
    });
  } catch (error: unknown) {
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'createBillingPortalSession',
      stripeError: error instanceof Error ? error.message : String(error),
    });
  }

  let scopedSubscriptionId: string | undefined;
  if (purpose === 'cancel') {
    const subscriptionId = user.stylist_account.subscription_id;
    try {
      if (subscriptionId == null) {
        throw new Error('No subscription to cancel');
      }
      const subscription = await getStripe().subscriptions.retrieve(
        subscriptionId,
        {
          expand: ['items.data.price.product'],
        }
      );
      const product = subscription.items.data[0]?.price.product;
      if (
        product == null ||
        typeof product === 'string' ||
        product.deleted ||
        !isScopedToNailfolio(product.metadata.planId)
      ) {
        throw new Error('Subscription is outside Nailfolio scope');
      }
      const customerId =
        typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer.id;
      if (customerId !== stripeCustomerId) {
        throw new Error('Subscription customer mismatch');
      }
      scopedSubscriptionId = subscriptionId;
    } catch (error: unknown) {
      return failure({
        type: 'ACCOUNT_STRIPE_ERROR',
        operation: 'createBillingPortalSession:scope',
        stripeError: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const portalSessionParams = buildPortalSessionParams({
    customer: stripeCustomerId,
    ...(scopedSubscriptionId != null
      ? { subscription: scopedSubscriptionId }
      : {}),
    purpose,
    locale,
    base: ENV_VARS.STRIPE_PORTAL_RETURN_URL || ENV_VARS.PUBLIC_URL,
    ...(ENV_VARS.STRIPE_PORTAL_CONFIGURATION_ID
      ? { configuration: ENV_VARS.STRIPE_PORTAL_CONFIGURATION_ID }
      : {}),
  });

  let portalSession: Stripe.BillingPortal.Session;
  try {
    portalSession =
      await getStripe().billingPortal.sessions.create(portalSessionParams);
  } catch (error: unknown) {
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'createBillingPortalSession',
      stripeError: error instanceof Error ? error.message : String(error),
    });
  }

  return success({
    portalUrl: portalSession.url,
    portalSessionId: portalSession.id,
  });
};
