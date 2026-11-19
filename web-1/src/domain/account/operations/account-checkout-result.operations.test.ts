import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { PLAN_ID_MAP } from '@kernel/domain/stripe/stripe.config';
import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import type { CheckoutAttemptRow } from './checkout-attempt.types';
vi.mock('@app/db/db.client', () => ({ DB_CLIENT: { use: {} } }));
vi.mock('@app/stripe/adapters/stripe.adapter', () => ({ getStripe: vi.fn() }));
import { readCheckoutResult } from './account-checkout-result.operations';

function setup() {
  const account = {
    account_id: 'account-a',
    stripe_customer_id: 'cus_a',
    subscription_id: 'sub_a',
    subscription_status: 'ACTIVE',
    pricing_plan: PricingPlanValue.PRO,
    account_status: 'ACTIVE' as
      'ACTIVE' | 'NOT_ACTIVE' | 'EXPIRING' | 'EXPIRED',
    payment_status: 'PAID' as 'PAID' | 'UNPAID' | 'IN_PROGRESS' | 'REJECTED',
    current_period_end: new Date(Date.now() + 86_400_000) as Date | null,
    account_expiration_date: null as Date | null,
  };
  const row = {
    account_id: 'account-a',
    attempt_id: 'attempt-a',
    customer_id: 'cus_a',
    stripe_session_id: 'cs_a',
    stripe_subscription_id: 'sub_a',
    phase: 'open',
    expires_at: new Date('2026-12-01T00:00:00Z'),
    stripe_params: {
      mode: 'subscription',
      customer: 'cus_a',
      expires_at: Date.parse('2026-12-01T00:00:00Z') / 1000,
      client_reference_id: 'user-a',
      line_items: [{ price: 'price_a', quantity: 1 }],
      metadata: {
        projectId: 'nailfolio',
        accountId: 'account-a',
        attemptId: 'attempt-a',
        planId: PLAN_ID_MAP.PRO,
        billingPeriod: 'month',
      },
      subscription_data: {
        metadata: {
          projectId: 'nailfolio',
          accountId: 'account-a',
          attemptId: 'attempt-a',
          planId: PLAN_ID_MAP.PRO,
          billingPeriod: 'month',
        },
      },
    },
    response_meta: {
      returnUrl: 'https://example.test/return',
      billingAddressRequired: false,
      promoRejected: false,
    },
    intent: {
      userId: 'user-a',
      accountId: 'account-a',
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
    },
  } as unknown as CheckoutAttemptRow;
  const session = {
    id: 'cs_a',
    mode: 'subscription',
    status: 'complete',
    customer: 'cus_a',
    subscription: 'sub_a',
    payment_status: 'paid',
    client_reference_id: 'user-a',
    metadata: {
      projectId: 'nailfolio',
      accountId: 'account-a',
      attemptId: 'attempt-a',
      planId: PLAN_ID_MAP.PRO,
      billingPeriod: 'month',
    },
  } as unknown as Stripe.Checkout.Session;
  const subscription = {
    id: 'sub_a',
    customer: 'cus_a',
    status: 'active',
    metadata: {
      projectId: 'nailfolio',
      accountId: 'account-a',
      attemptId: 'attempt-a',
      planId: PLAN_ID_MAP.PRO,
      billingPeriod: 'month',
    },
    items: {
      data: [{ price: { id: 'price_a', recurring: { interval: 'month' } } }],
    },
  } as unknown as Stripe.Subscription;
  return {
    account,
    row,
    session,
    subscription,
    deps: {
      account: vi.fn(async () => account),
      attempt: vi.fn(async () => row),
      session: vi.fn(async () => session),
      subscription: vi.fn(async () => subscription),
    },
  };
}
const run = (x: ReturnType<typeof setup>) =>
  readCheckoutResult('user-a', 'cs_a', x.deps);
describe('owned checkout result', () => {
  it('confirms only when Stripe generation and stored entitlement agree', async () => {
    const x = setup();
    expect(await run(x)).toEqual({
      status: 'confirmed',
      target: { planId: PricingPlanValue.PRO, billingPeriod: 'month' },
    });
    x.account.subscription_status = 'INCOMPLETE';
    expect((await run(x)).status).toBe('pending');
    x.account.subscription_status = 'ACTIVE';
    const recurring = x.subscription.items.data[0]?.price.recurring;
    if (!recurring) {
      throw new Error('missing test interval');
    }
    recurring.interval = 'year';
    expect((await run(x)).status).toBe('pending');
  });
  it('never confirms a foreign session, stale generation or provider failure', async () => {
    const x = setup();
    if (!x.session.metadata) {
      throw new Error('missing test metadata');
    }
    x.session.metadata.accountId = 'foreign';
    expect(await run(x)).toEqual({ status: 'unknown', target: null });
    x.session.metadata.accountId = 'account-a';
    x.deps.attempt
      .mockResolvedValueOnce(x.row)
      .mockResolvedValueOnce({ ...x.row, attempt_id: 'new' });
    expect((await run(x)).status).toBe('unknown');
    x.deps.session.mockRejectedValueOnce(new Error('provider unavailable'));
    expect(await run(x)).toEqual({ status: 'unknown', target: null });
  });
  it('reports pending or expiry only for the current owned session', async () => {
    const x = setup();
    x.session.status = 'open';
    expect((await run(x)).status).toBe('pending');
    x.session.status = 'expired';
    expect((await run(x)).status).toBe('expired');
    x.row.stripe_session_id = 'cs_other';
    expect((await run(x)).status).toBe('unknown');
  });
  it('does not disclose another user or subscription', async () => {
    const x = setup();
    x.row.intent = {
      userId: 'other',
      accountId: 'account-a',
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
    };
    expect((await run(x)).status).toBe('unknown');
    expect(x.deps.session).not.toHaveBeenCalled();
  });
  it('requires an actually settled session or a no-payment-required trial', async () => {
    const x = setup();
    x.session.payment_status = 'unpaid';
    expect((await run(x)).status).toBe('pending');
    x.session.payment_status = 'no_payment_required';
    expect((await run(x)).status).toBe('confirmed');
  });
  it('does not confirm a disabled, unpaid or expired account entitlement', async () => {
    const x = setup();
    x.account.account_status = 'NOT_ACTIVE';
    expect((await run(x)).status).toBe('pending');
    x.account.account_status = 'EXPIRED';
    expect((await run(x)).status).toBe('pending');
    x.account.account_status = 'ACTIVE';
    x.account.payment_status = 'UNPAID';
    expect((await run(x)).status).toBe('pending');
    x.account.payment_status = 'PAID';
    x.account.current_period_end = new Date(Date.now() - 1);
    expect((await run(x)).status).toBe('pending');
    x.account.current_period_end = null;
    expect((await run(x)).status).toBe('pending');
    x.account.current_period_end = new Date(Date.now() + 60_000);
    x.account.account_expiration_date = new Date(Date.now() - 1);
    expect((await run(x)).status).toBe('pending');
  });
  it('rejects provider price, session plan, subscription plan or frozen target mismatch', async () => {
    const x = setup();
    const item = x.subscription.items.data[0];
    if (!item || !x.session.metadata) {
      throw new Error('missing test setup');
    }
    item.price.id = 'price_other';
    expect((await run(x)).status).toBe('unknown');
    item.price.id = 'price_a';
    x.session.metadata.planId = PLAN_ID_MAP.PRO_PLUS;
    expect((await run(x)).status).toBe('unknown');
    x.session.metadata.planId = PLAN_ID_MAP.PRO;
    x.subscription.metadata.planId = PLAN_ID_MAP.PRO_PLUS;
    expect((await run(x)).status).toBe('unknown');
    x.subscription.metadata.planId = PLAN_ID_MAP.PRO;
    x.row.intent = {
      userId: 'user-a',
      accountId: 'account-a',
      planId: PricingPlanValue.PRO_PLUS,
      billingPeriod: 'month',
    };
    expect((await run(x)).status).toBe('unknown');
  });
});
