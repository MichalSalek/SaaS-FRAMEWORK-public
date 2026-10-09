/**
 * ENTITLEMENT-ACTIVE GATE — regression test (testy-api hardening płatności).
 *
 * `pricing_plan` JEST jedynym źródłem uprawnień (gallery-create/user-query czytają
 * wyłącznie pricing_plan; account-state-guard gejtuje na is_active, NIE na Stripe-owym
 * account_status). Dlatego handleSubscriptionUpdated MUSI promować do planu płatnego
 * TYLKO gdy subskrypcja realnie daje dostęp (isSubscriptionActive). Non-active status
 * (incomplete/unpaid/paused/canceled) → pricing_plan=FREE, inaczej nieopłacona
 * subskrypcja zostawiałaby PRO-quota bez płatności (unpaid entitlement leak).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { getPlanIdFromPricingPlanValue } from '@app/stripe/stripe.config';

// ── Account zwracany przez lookup (startuje na FREE). ──────────────────────────
const account = {
  account_id: 'acc_1',
  pricing_plan: PricingPlanValue.FREE as PricingPlan,
  created_by_user_id: 'usr_1',
  subscription_status: null,
  subscription_id: null as string | null,
};
vi.mock('@app/stripe/webhooks/stripe-webhooks.db', () => ({
  findAccountByCustomerId: vi.fn(async () => account),
}));

// ── SSOT plan-writer: spy (zwraca applied=true). vi.hoisted → referencja bezpieczna
// w hoistowanej fabryce vi.mock; typowany param → typed dostęp do mock.calls. ─────
const { updateAccountPlanStatus } = vi.hoisted(() => ({
  updateAccountPlanStatus: vi.fn(
    async (_params: { pricingPlan: PricingPlan; accountStatus: string }) => true
  ),
}));
vi.mock('@app/stripe/plan-status-update.operations', () => ({
  updateAccountPlanStatus,
}));

// ── Brak pending/schedule → ścieżka natychmiastowego sync (write). ─────────────
vi.mock('@app/stripe/subscription-schedule.utils', () => ({
  hasPendingUpdate: () => false,
  hasActiveSchedule: () => false,
  extractSubscriptionDateFields: () => ({
    cancelAt: null,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
  }),
}));

// ── Wymuś ścieżkę zmiany stanu (nie no-op); efekty churn/trial = noop. ─────────
vi.mock('./subscription-update.utils', () => ({
  hasSubscriptionStateChanged: () => true,
  updateAccountStatusWithoutPlanChange: vi.fn(async () => undefined),
  handleChurnAlert: vi.fn(async () => null),
  // O3 (downgrade alert): nowy eksport wołany przez handleSubscriptionUpdated —
  // noop-effect jak handleChurnAlert (alerty poza zakresem tego gate-testu).
  handleDowngradeAlert: vi.fn(async () => null),
  handleTrialFieldsUpdate: vi.fn(async () => undefined),
  buildSubscriptionAnalyticsEffects: vi.fn(() => []),
}));

vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: vi.fn(),
}));

import { handleSubscriptionUpdated } from './subscription-lifecycle.handler';

const PRO_PLAN_ID = getPlanIdFromPricingPlanValue(PricingPlanValue.PRO);

const buildSubscription = (status: string) =>
  ({
    id: 'sub_1',
    customer: 'cus_1',
    status,
    metadata: {},
    pending_update: null,
    items: {
      data: [
        {
          id: 'si_1',
          price: { id: 'price_1', product: 'prod_1' },
          current_period_end: 1_900_000_000,
        },
      ],
    },
  }) as never;

const callWith = (status: string) =>
  handleSubscriptionUpdated({
    subscription: buildSubscription(status),
    eventCreatedAt: new Date(1_800_000_000_000),
    prefetchedPlanId: PRO_PLAN_ID,
  });

const writtenPlan = () => updateAccountPlanStatus.mock.calls.at(-1)?.[0];

describe('handleSubscriptionUpdated — entitlement-active gate', () => {
  beforeEach(() => {
    updateAccountPlanStatus.mockClear();
    account.pricing_plan = PricingPlanValue.FREE;
    account.subscription_id = null;
  });

  it('active subscription → promuje pricing_plan do planu z ceny (PRO)', async () => {
    await callWith('active');
    expect(updateAccountPlanStatus).toHaveBeenCalledTimes(1);
    expect(writtenPlan()?.pricingPlan).toBe(PricingPlanValue.PRO);
  });

  it('trialing → promuje do PRO (trial daje dostęp)', async () => {
    await callWith('trialing');
    expect(writtenPlan()?.pricingPlan).toBe(PricingPlanValue.PRO);
  });

  it.each(['incomplete', 'incomplete_expired', 'unpaid', 'paused', 'canceled'])(
    'non-active status %s (canonical/no sub) → pisze FREE (NIE PRO), zero unpaid-entitlement',
    async status => {
      await callWith(status);
      expect(updateAccountPlanStatus).toHaveBeenCalledTimes(1);
      expect(writtenPlan()?.pricingPlan).toBe(PricingPlanValue.FREE);
    }
  );

  it('non-canonical non-active sub (konto ma inną current sub) → BRAK write (płacące konto chronione przed osieroconą wtórną sub)', async () => {
    // Konto śledzi aktywną sub A; przychodzi non-active event dla osieroconej sub B.
    account.subscription_id = 'sub_A';
    account.pricing_plan = PricingPlanValue.PRO;
    // buildSubscription używa id 'sub_1' (≠ 'sub_A') → non-canonical.
    await callWith('incomplete_expired');
    expect(updateAccountPlanStatus).not.toHaveBeenCalled();
  });

  it('canonical non-active sub (event == account.subscription_id) → pisze FREE', async () => {
    account.subscription_id = 'sub_1'; // == buildSubscription id
    await callWith('canceled');
    expect(updateAccountPlanStatus).toHaveBeenCalledTimes(1);
    expect(writtenPlan()?.pricingPlan).toBe(PricingPlanValue.FREE);
  });
});
