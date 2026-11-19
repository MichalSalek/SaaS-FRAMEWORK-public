/**
 * invoice.payment_succeeded audit payload. The subscription id comes from the
 * invoice parent already on the event, never from the account row and never
 * from a Stripe retrieve. A zero amount is still written so a later 100%
 * invoice remains visible to the financial-proof query.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { mockDb } from '../../../../test-utils/mockApiHandler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  AccountStatusValue,
  PaymentStatusValue,
  SubscriptionStatusValue,
} from '@kernel/models/db_models.generated.dto';

vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

const { updateAccountPlanStatus } = vi.hoisted(() => ({
  updateAccountPlanStatus: vi.fn(async () => true),
}));
vi.mock('@app/stripe/plan-status-update.operations', () => ({
  updateAccountPlanStatus,
}));

vi.mock('@app/email-handler/outbox/email-outbox', () => ({
  enqueueEmailOutboxTx: vi.fn(async () => null),
  kickEmailOutbox: vi.fn(() => async () => undefined),
}));

vi.mock('@app/stripe/webhooks/stripe-webhooks.utils', () => ({
  extractCustomerId: ({ customer }: { customer: unknown }) =>
    typeof customer === 'string' ? customer : undefined,
}));

import { handleInvoicePaymentSucceeded } from './invoice.handler';

const CUSTOMER_ID = 'cus_nailfolio_test_1';
const ACCOUNT_ID = 'acc_test_0000000000000001';
const USER_ID = 'usr_test_0000000000000001';
const EVENT_AT = new Date('2026-05-01T00:00:00.000Z');

const installDb = (overrides: Record<string, unknown> = {}) => {
  const eventLogCreate = vi.fn(
    async (args: { data: Record<string, unknown> }) => ({
      event_log_id: 'evl_test_1',
      created_at: EVENT_AT,
      ...args.data,
    })
  );
  mockDb({
    stylistAccount: {
      findUnique: vi.fn(async () => ({
        account_id: ACCOUNT_ID,
        created_by_user_id: USER_ID,
        created_at: EVENT_AT,
        pricing_plan: PricingPlanValue.PRO,
        account_status: AccountStatusValue.ACTIVE,
        subscription_id: 'sub_on_account',
        payment_status: PaymentStatusValue.PAID,
        subscription_status: SubscriptionStatusValue.ACTIVE,
        cancel_at_period_end: false,
        cancel_at: null,
        current_period_end: null,
        ...overrides,
      })),
    },
    eventLog: { create: eventLogCreate },
  });
  return { eventLogCreate };
};

const payloadOf = (
  eventLogCreate: ReturnType<typeof installDb>['eventLogCreate']
): Record<string, unknown> => {
  const call = eventLogCreate.mock.calls[0]?.[0];
  const payload = call?.data.event_payload;
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new Error('expected an EventLog write');
  }
  return payload as Record<string, unknown>;
};

const invoiceWithParent = (
  parent: Stripe.Invoice['parent'],
  amountPaid: number
): Stripe.Invoice =>
  ({
    id: 'in_audit_1',
    customer: CUSTOMER_ID,
    amount_paid: amountPaid,
    parent,
  }) as unknown as Stripe.Invoice;

describe('handleInvoicePaymentSucceeded audit payload', () => {
  beforeEach(() => {
    updateAccountPlanStatus.mockClear();
  });

  it('records an old subscription invoice without changing the current account payment status', async () => {
    const db = installDb({ payment_status: PaymentStatusValue.UNPAID });
    await handleInvoicePaymentSucceeded({
      invoice: invoiceWithParent(
        {
          type: 'subscription_details',
          quote_details: null,
          subscription_details: { metadata: null, subscription: 'sub_old' },
        },
        4900
      ),
      eventCreatedAt: EVENT_AT,
    });
    expect(payloadOf(db.eventLogCreate)).toMatchObject({
      subscriptionId: 'sub_old',
    });
    expect(updateAccountPlanStatus).not.toHaveBeenCalled();
  });

  it.each(['missing parent', 'missing current subscription'])(
    'does not mutate payment status for %s',
    async scenario => {
      const db = installDb({
        payment_status: PaymentStatusValue.UNPAID,
        ...(scenario === 'missing current subscription'
          ? { subscription_id: null }
          : {}),
      });
      const parent =
        scenario === 'missing parent'
          ? null
          : {
              type: 'subscription_details' as const,
              quote_details: null,
              subscription_details: {
                metadata: null,
                subscription: 'sub_on_account',
              },
            };
      await handleInvoicePaymentSucceeded({
        invoice: invoiceWithParent(parent, 4900),
        eventCreatedAt: EVENT_AT,
      });
      expect(db.eventLogCreate).toHaveBeenCalled();
      expect(updateAccountPlanStatus).not.toHaveBeenCalled();
    }
  );

  it('updates payment status only for the current subscription with a write fence', async () => {
    installDb({ payment_status: PaymentStatusValue.UNPAID });
    await handleInvoicePaymentSucceeded({
      invoice: invoiceWithParent(
        {
          type: 'subscription_details',
          quote_details: null,
          subscription_details: {
            metadata: null,
            subscription: 'sub_on_account',
          },
        },
        4900
      ),
      eventCreatedAt: EVENT_AT,
    });
    expect(updateAccountPlanStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedSubscriptionId: 'sub_on_account',
        paymentStatus: PaymentStatusValue.PAID,
      })
    );
  });

  it('writes the parent subscription id, not the id stored on the account', async () => {
    const db = installDb();

    await handleInvoicePaymentSucceeded({
      invoice: invoiceWithParent(
        {
          type: 'subscription_details',
          quote_details: null,
          subscription_details: {
            metadata: null,
            subscription: 'sub_from_parent',
          },
        },
        4900
      ),
      eventCreatedAt: EVENT_AT,
    });

    expect(payloadOf(db.eventLogCreate)).toEqual({
      accountId: ACCOUNT_ID,
      invoiceId: 'in_audit_1',
      amountPaid: 4900,
      subscriptionId: 'sub_from_parent',
    });
    expect(updateAccountPlanStatus).not.toHaveBeenCalled();
    expect(db.eventLogCreate.mock.calls[0]?.[0].data.event).toBe(
      APP_EVENTS.INFO.ACCOUNT.STRIPE_INVOICE_PAYMENT_SUCCEEDED
    );
  });

  it('reads an expanded subscription object id from the same parent', async () => {
    const db = installDb();

    await handleInvoicePaymentSucceeded({
      invoice: invoiceWithParent(
        {
          type: 'subscription_details',
          quote_details: null,
          subscription_details: {
            metadata: null,
            subscription: { id: 'sub_expanded' } as Stripe.Subscription,
          },
        },
        4900
      ),
      eventCreatedAt: EVENT_AT,
    });

    expect(payloadOf(db.eventLogCreate).subscriptionId).toBe('sub_expanded');
  });

  it('records a zero invoice with its subscription id and does not invent one', async () => {
    const db = installDb();

    await handleInvoicePaymentSucceeded({
      invoice: invoiceWithParent(
        {
          type: 'subscription_details',
          quote_details: null,
          subscription_details: {
            metadata: null,
            subscription: 'sub_zero',
          },
        },
        0
      ),
      eventCreatedAt: EVENT_AT,
    });

    expect(payloadOf(db.eventLogCreate)).toMatchObject({
      amountPaid: 0,
      subscriptionId: 'sub_zero',
    });
  });

  it('omits subscriptionId when the invoice is not a subscription invoice', async () => {
    const db = installDb();

    await handleInvoicePaymentSucceeded({
      invoice: invoiceWithParent(
        {
          type: 'quote_details',
          quote_details: { quote: 'qt_1' },
          subscription_details: null,
        },
        4900
      ),
      eventCreatedAt: EVENT_AT,
    });

    expect(payloadOf(db.eventLogCreate)).not.toHaveProperty('subscriptionId');

    const dbBare = installDb();
    await handleInvoicePaymentSucceeded({
      invoice: invoiceWithParent(null, 4900),
      eventCreatedAt: EVENT_AT,
    });
    expect(payloadOf(dbBare.eventLogCreate)).not.toHaveProperty(
      'subscriptionId'
    );
  });
});
