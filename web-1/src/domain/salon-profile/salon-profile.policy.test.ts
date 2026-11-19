import { describe, it, expect } from 'vitest';
import { canManageSalonProfile } from './salon-profile.policy';
import type { SubscriptionStatus } from '@kernel/models/db_models.generated.dto';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
type Owner = Parameters<typeof canManageSalonProfile>[0];
const active: Owner = {
  pricing_plan: 'STUDIO',
  subscription_status: 'ACTIVE',
  payment_status: 'PAID',
  account_status: 'ACTIVE',
  account_expiration_date: null,
};
describe('salon public profile plan boundary', () => {
  it.each<PricingPlan>(['FREE', 'PRO', 'PRO_PLUS'])(
    'rejects own %s plan',
    pricing_plan => {
      expect(canManageSalonProfile({ ...active, pricing_plan })).toBe(false);
    }
  );
  it.each<PricingPlan>(['STUDIO', 'SCALE'])(
    'allows active own %s',
    pricing_plan => {
      expect(canManageSalonProfile({ ...active, pricing_plan })).toBe(true);
    }
  );
  it.each<SubscriptionStatus>([
    'PAST_DUE',
    'CANCELED',
    'UNPAID',
    'PAUSED',
    'INCOMPLETE',
  ])('rejects %s subscription', subscription_status => {
    expect(canManageSalonProfile({ ...active, subscription_status })).toBe(
      false
    );
  });
  it('rejects expired and disabled owners', () => {
    expect(
      canManageSalonProfile({ ...active, account_expiration_date: new Date(0) })
    ).toBe(false);
    expect(
      canManageSalonProfile({ ...active, account_status: 'NOT_ACTIVE' })
    ).toBe(false);
  });
  it('supports paid administrator grants and trials', () => {
    expect(
      canManageSalonProfile({ ...active, subscription_status: null })
    ).toBe(true);
    expect(
      canManageSalonProfile({ ...active, subscription_status: 'TRIALING' })
    ).toBe(true);
  });
});
