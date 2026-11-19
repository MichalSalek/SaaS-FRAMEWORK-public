import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bindPurchaseResumeSession,
  clearPurchaseResume,
  consumePurchaseResume,
  readPurchaseResume,
  resolvePurchaseResume,
  savePurchaseResume,
  type PurchaseResumeIntent,
} from './purchase-resume';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';

const storage = vi.hoisted(() => ({
  value: null as string | null,
  broken: false,
}));
vi.mock('./clientStorage.possibilities.api', () => ({
  getFromClientStorage: () => {
    if (storage.broken) {
      throw new Error('unavailable');
    }
    return storage.value;
  },
  setToClientStorage: ({ value }: { value: string }) => {
    if (storage.broken) {
      throw new Error('unavailable');
    }
    storage.value = value;
  },
  deleteFromClientStorage: () => {
    if (storage.broken) {
      throw new Error('unavailable');
    }
    storage.value = null;
  },
}));
const identity = { userId: 'user-a', accountId: 'account-a' };
const now = 1_800_000_000_000;
const intent = (): PurchaseResumeIntent => ({
  ...identity,
  id: 'intent-a',
  createdAt: now,
  action: { kind: 'upload' },
  sessionId: null,
});
beforeEach(() => {
  storage.value = null;
  storage.broken = false;
  vi.setSystemTime(now);
});
describe('device purchase resume', () => {
  it('binds only the current intent and consumes it only after matching navigation', () => {
    expect(savePurchaseResume(intent())).toBe(true);
    expect(bindPurchaseResumeSession(identity, 'old', 'cs_test_old')).toBe(
      false
    );
    expect(bindPurchaseResumeSession(identity, 'intent-a', 'cs_test_new')).toBe(
      true
    );
    expect(readPurchaseResume(identity)?.sessionId).toBe('cs_test_new');
    consumePurchaseResume(identity, 'old', 'cs_test_new');
    expect(readPurchaseResume(identity)).not.toBeNull();
    consumePurchaseResume(identity, 'intent-a', 'cs_test_old');
    expect(readPurchaseResume(identity)).not.toBeNull();
    consumePurchaseResume(identity, 'intent-a', 'cs_test_new');
    expect(readPurchaseResume(identity)).toBeNull();
  });
  it('rejects foreign identity, future and expired data', () => {
    savePurchaseResume(intent());
    expect(readPurchaseResume({ ...identity, accountId: 'other' })).toBeNull();
    savePurchaseResume(intent());
    expect(readPurchaseResume(identity, now + 86_400_000)).toBeNull();
    savePurchaseResume(intent());
    expect(readPurchaseResume(identity, now - 1)).toBeNull();
  });
  it('rejects URLs and extra content and safely handles unavailable storage', () => {
    storage.value = JSON.stringify({
      ...intent(),
      action: { kind: 'client', clientId: '../evil' },
    });
    expect(readPurchaseResume(identity)).toBeNull();
    storage.value = JSON.stringify({
      ...intent(),
      url: 'https://evil.example',
    });
    expect(readPurchaseResume(identity)).toBeNull();
    storage.broken = true;
    expect(savePurchaseResume(intent())).toBe(false);
    expect(readPurchaseResume(identity)).toBeNull();
    expect(() => clearPurchaseResume()).not.toThrow();
  });
  it('permits only routes whose capability is unlocked', () => {
    expect(resolvePurchaseResume(intent(), PricingPlanValue.PRO)?.href).toBe(
      '/app/gallery/upload-asset'
    );
    const brand = { ...intent(), action: { kind: 'brand' as const } };
    expect(resolvePurchaseResume(brand, PricingPlanValue.PRO)).toBeNull();
    expect(
      resolvePurchaseResume(brand, PricingPlanValue.PRO_PLUS)?.href
    ).toContain('#brand-colour');
    const client = {
      ...intent(),
      action: { kind: 'client' as const, clientId: 'client-1' },
    };
    expect(resolvePurchaseResume(client, PricingPlanValue.PRO)?.href).toBe(
      '/app/clients/client-1'
    );
  });
});
