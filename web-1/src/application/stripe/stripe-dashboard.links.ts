/**
 * Links from admin alert mails to one object in the Stripe dashboard (no /test
 * prefix).
 * Returns a spreadable prop so callers without an id simply get no link.
 */

const STRIPE_DASHBOARD_URL = 'https://dashboard.stripe.com';

type StripeDashboardObject =
  'customers' | 'subscriptions' | 'disputes' | 'events';

type StripeRef = string | { id: string } | null | undefined;

const idOf = (ref: StripeRef): string | null => {
  if (typeof ref === 'string') {
    return ref.length > 0 ? ref : null;
  }
  return ref?.id ?? null;
};

export const stripeDashboardLinkProp = (
  object: StripeDashboardObject,
  ref: StripeRef
): { link: { label: string; url: string } } | Record<string, never> => {
  const id = idOf(ref);
  return id
    ? {
        link: {
          label: 'Otwórz w panelu Stripe',
          url: `${STRIPE_DASHBOARD_URL}/${object}/${encodeURIComponent(id)}`,
        },
      }
    : {};
};
