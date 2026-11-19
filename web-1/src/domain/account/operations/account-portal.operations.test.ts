import { PLAN_ID_MAP } from '@kernel/domain/stripe/stripe.config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { findUnique, customer, retrieve, create } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  customer: vi.fn(),
  retrieve: vi.fn(),
  create: vi.fn(),
}));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: { use: { user: { findUnique } } },
}));
vi.mock('@app/stripe/customer.operations', () => ({
  getOrCreateStripeCustomer: customer,
}));
vi.mock('@app/stripe/adapters/stripe.adapter', () => ({
  getStripe: () => ({
    subscriptions: { retrieve },
    billingPortal: { sessions: { create } },
  }),
}));
vi.mock('@app/environment/environment.config', () => ({
  ENV_VARS: {
    PUBLIC_URL: 'https://example.com',
    STRIPE_PORTAL_RETURN_URL: 'https://override.example/old',
    STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_owned',
  },
}));
vi.mock('@app/errors/error-result.helpers', () => ({
  databaseFailure: () => ({
    success: false,
    error: { type: 'DATABASE_ERROR' },
  }),
}));
import { createBillingPortalSession_IO } from './account-portal.operations';

const subscription = (
  planId: string = PLAN_ID_MAP.STUDIO,
  customerId = 'cus_owned'
) => ({
  customer: customerId,
  items: { data: [{ price: { product: { metadata: { planId } } } }] },
});
describe('portal SDK scope and purpose', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue({
      email: 'owner@example.com',
      stylist_account: {
        account_id: 'account-owned',
        subscription_id: 'sub_owned',
      },
    });
    customer.mockResolvedValue('cus_owned');
    retrieve.mockResolvedValue(subscription());
    create.mockResolvedValue({
      url: 'https://billing.stripe.com/session',
      id: 'bps_owned',
    });
  });
  it('cancel retrieves only the stored subscription and creates a cancellation deep link', async () => {
    expect(
      (
        await createBillingPortalSession_IO({
          userId: 'session-user',
          purpose: 'cancel',
        })
      ).success
    ).toBe(true);
    expect(retrieve).toHaveBeenCalledWith('sub_owned', {
      expand: ['items.data.price.product'],
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        configuration: 'bpc_owned',
        return_url:
          'https://override.example/app/user/account/plan?portal=back',
        flow_data: expect.objectContaining({
          subscription_cancel: { subscription: 'sub_owned' },
        }),
      })
    );
  });
  it.each([
    ['foreign-product', 'cus_owned'],
    [PLAN_ID_MAP.STUDIO, 'cus_other'],
  ])('rejects foreign scope %s or customer %s', async (planId, customerId) => {
    retrieve.mockResolvedValue(subscription(planId, customerId));
    expect(
      (
        await createBillingPortalSession_IO({
          userId: 'session-user',
          purpose: 'cancel',
        })
      ).success
    ).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
  it('manage is a plain session with locale-aware return and no subscription fetch', async () => {
    await createBillingPortalSession_IO({
      userId: 'session-user',
      locale: 'en',
    });
    expect(retrieve).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({
      customer: 'cus_owned',
      configuration: 'bpc_owned',
      return_url:
        'https://override.example/en/app/user/account/plan?portal=back',
    });
  });
});
