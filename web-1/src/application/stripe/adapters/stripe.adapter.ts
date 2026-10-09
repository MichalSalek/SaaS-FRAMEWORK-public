import Stripe from 'stripe';
import { ENV_VARS } from '@app/environment/environment.config';
import { STRIPE_CONFIG } from '@kernel/application/constants.config';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

let stripeClient: Stripe | undefined;

export const getStripe = (): Stripe => {
  if (stripeClient) {
    return stripeClient;
  }

  if (!ENV_VARS.STRIPE_SECRET_KEY) {
    throw new Error(APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED);
  }

  stripeClient = new Stripe(ENV_VARS.STRIPE_SECRET_KEY, {
    // API version pulled from shared-kernel SSOT (STRIPE_CONFIG.API_VERSION).
    // Stripe SDK types apiVersion as a literal union (Stripe.LatestApiVersion |
    // historical strings). Cast to NonNullable since the SDK type includes
    // `undefined` (default = account version) and we always want explicit pin.
    apiVersion: STRIPE_CONFIG.API_VERSION as NonNullable<
      Stripe.StripeConfig['apiVersion']
    >,
    timeout: STRIPE_CONFIG.API_TIMEOUT_MS,
    maxNetworkRetries: 2,
    appInfo: {
      name: 'app-FRAMEWORK',
      version: '1.0.0',
      url: ENV_VARS.PUBLIC_URL ?? 'https://localhost:3000',
    },
    typescript: true,
  });

  return stripeClient;
};
