import type Stripe from 'stripe';

export function buildPortalReturnUrl(
  base: string,
  marker: 'back' | 'canceled',
  locale = 'pl'
): string {
  const url = new URL(base);
  url.pathname = `${locale === 'pl' ? '' : `/${locale}`}/app/user/account/plan`;
  url.search = new URLSearchParams({ portal: marker }).toString();
  url.hash = '';
  return url.toString();
}

export function buildPortalSessionParams({
  customer,
  subscription,
  purpose = 'manage',
  locale = 'pl',
  base,
  configuration,
}: {
  customer: string;
  subscription?: string;
  purpose?: 'manage' | 'cancel';
  locale?: string;
  base: string;
  configuration?: string;
}): Stripe.BillingPortal.SessionCreateParams {
  if (purpose === 'cancel' && subscription == null) {
    throw new Error('Cancellation requires a Nailfolio subscription');
  }
  return {
    customer,
    return_url: buildPortalReturnUrl(base, 'back', locale),
    ...(configuration ? { configuration } : {}),
    ...(purpose === 'cancel' && subscription != null
      ? {
          flow_data: {
            type: 'subscription_cancel',
            subscription_cancel: { subscription },
            after_completion: {
              type: 'redirect',
              redirect: {
                return_url: buildPortalReturnUrl(base, 'canceled', locale),
              },
            },
          },
        }
      : {}),
  };
}
