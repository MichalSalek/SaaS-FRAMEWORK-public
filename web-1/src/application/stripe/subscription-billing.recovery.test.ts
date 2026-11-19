import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAN_ID_MAP } from '@kernel/domain/stripe/stripe.config';
const { retrieve, preview } = vi.hoisted(() => ({
  retrieve: vi.fn(),
  preview: vi.fn(),
}));
vi.mock('./adapters/stripe.adapter', () => ({
  getStripe: () => ({
    subscriptions: { retrieve },
    invoices: { createPreview: preview },
  }),
}));
import { readSubscriptionBilling_IO } from './subscription-billing.operations';
const sub = () => ({
  id: 'sub_pending',
  metadata: { accountId: 'owned' },
  status: 'active',
  cancel_at: null,
  cancel_at_period_end: false,
  items: {
    data: [
      {
        price: {
          currency: 'pln',
          recurring: { interval: 'month' },
          product: { metadata: { planId: PLAN_ID_MAP.PRO } },
        },
      },
    ],
  },
  latest_invoice: {
    id: 'in_pending',
    status: 'open',
    amount_remaining: 1200,
    currency: 'pln',
    hosted_invoice_url: 'https://invoice.stripe.com/i/owned/in_pending',
    parent: { subscription_details: { subscription: 'sub_pending' } },
  },
});
describe('pending billing survives re-entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    retrieve.mockResolvedValue(sub());
    preview.mockRejectedValue(new Error('No upcoming invoice while pending'));
  });
  it('returns the existing unpaid invoice even when no upcoming invoice can be previewed', async () => {
    expect(
      await readSubscriptionBilling_IO('sub_pending', 'owned')
    ).toMatchObject({
      pendingPayment: {
        invoiceId: 'in_pending',
        amountRemaining: 1200,
        url: 'https://invoice.stripe.com/i/owned/in_pending',
      },
    });
    expect(preview).not.toHaveBeenCalled();
  });
});
