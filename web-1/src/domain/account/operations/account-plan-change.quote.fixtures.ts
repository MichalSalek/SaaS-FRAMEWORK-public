import { PLAN_ID_MAP } from '@kernel/domain/stripe/stripe.config';

export const SUB_ID = 'sub_test_active';
const ACCOUNT_ID = 'acc_test_0000000000000001';
export const PERIOD_END = 1_702_592_000;

export const owned = (
  patch: Record<string, unknown> = {}
): Record<string, unknown> => ({
  id: SUB_ID,
  status: 'active',
  metadata: { accountId: ACCOUNT_ID },
  discounts: [],
  default_tax_rates: [],
  trial_end: null,
  cancel_at: null,
  cancel_at_period_end: false,
  pending_update: null,
  latest_invoice: null,
  items: {
    data: [
      {
        id: 'si_test_item',
        quantity: 1,
        current_period_start: 1_700_000_000,
        current_period_end: PERIOD_END,
        discounts: [],
        tax_rates: null,
        price: {
          id: 'price_pro_month',
          currency: 'pln',
          recurring: { interval: 'month' },
          product: { metadata: { planId: PLAN_ID_MAP.PRO } },
        },
      },
    ],
  },
  ...patch,
});

export const itemOf = (
  subscription: Record<string, unknown>
): Record<string, unknown> => {
  const item = (subscription.items as { data: Record<string, unknown>[] })
    .data[0];
  if (item == null) {
    throw new Error('fixture has no subscription item');
  }
  return item;
};

export const figures = (patch: Record<string, unknown> = {}) => ({
  amount_due: 1290,
  total: 1290,
  currency: 'pln',
  total_taxes: [{ amount: 241 }],
  ...patch,
});

export const grossTargetPrice = (id: string, currency = 'pln') => ({
  id,
  currency,
  billing_scheme: 'per_unit',
  tax_behavior: 'inclusive',
  unit_amount: 4900,
});
