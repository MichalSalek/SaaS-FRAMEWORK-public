import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { mockDb } from '../../../../test-utils/mockApiHandler';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  AccountStatusValue,
  PaymentStatusValue,
  SubscriptionStatusValue,
} from '@kernel/models/db_models.generated.dto';

const mocks = vi.hoisted(() => ({ update: vi.fn(async () => true) }));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));
vi.mock('@app/stripe/plan-status-update.operations', () => ({
  updateAccountPlanStatus: mocks.update,
}));
vi.mock('@app/stripe/webhooks/stripe-webhooks.utils', () => ({
  extractCustomerId: ({ customer }: { customer: unknown }) =>
    typeof customer === 'string' ? customer : undefined,
}));
vi.mock('@app/email-handler/outbox/email-outbox', () => ({
  enqueueEmailOutboxTx: vi.fn(async () => null),
  kickEmailOutbox: vi.fn(() => async () => undefined),
}));
import { handleInvoicePaymentFailed } from './invoice.handler';

const installDb = (subscriptionId: string | null) => {
  const eventLogCreate = vi.fn(async () => ({ event_log_id: 'event' }));
  mockDb({
    stylistAccount: {
      findUnique: async () => ({
        account_id: 'account',
        created_by_user_id: 'user',
        created_at: new Date(),
        pricing_plan: PricingPlanValue.PRO,
        account_status: AccountStatusValue.ACTIVE,
        subscription_id: subscriptionId,
        payment_status: PaymentStatusValue.PAID,
        subscription_status: SubscriptionStatusValue.ACTIVE,
        cancel_at_period_end: false,
        cancel_at: null,
        current_period_end: null,
      }),
    },
    user: { findUnique: async () => null },
    eventLog: { create: eventLogCreate },
  });
  return eventLogCreate;
};
const invoice = (parentId: string | null): Stripe.Invoice =>
  ({
    id: 'invoice',
    customer: 'customer',
    attempt_count: 1,
    period_start: 1_700_000_000,
    parent:
      parentId === null
        ? null
        : {
            type: 'subscription_details',
            subscription_details: { subscription: parentId },
          },
  }) as unknown as Stripe.Invoice;

describe('failed invoice subscription lineage', () => {
  beforeEach(() => mocks.update.mockClear());
  it.each([
    ['old subscription', 'sub_current', 'sub_old'],
    ['missing parent', 'sub_current', null],
    ['missing current subscription', null, 'sub_current'],
  ])(
    'does not change payment state for %s',
    async (_label, current, parent) => {
      const audit = installDb(current);
      await handleInvoicePaymentFailed({
        invoice: invoice(parent),
        eventCreatedAt: new Date(),
      });
      expect(mocks.update).not.toHaveBeenCalled();
      expect(audit).toHaveBeenCalled();
    }
  );
  it('fences an update for the matching subscription', async () => {
    installDb('sub_current');
    await handleInvoicePaymentFailed({
      invoice: invoice('sub_current'),
      eventCreatedAt: new Date(),
    });
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedSubscriptionId: 'sub_current',
        paymentStatus: PaymentStatusValue.IN_PROGRESS,
      })
    );
  });
});
