import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPurchaseChangeProof,
  readPurchaseChangeProof,
  savePurchaseChangeProof,
} from './purchase-change-proof';
const state = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('./session-storage-adapter/sessionStorage.adapter', () => ({
  getSessionStorage: () => state.value,
  setSessionStorage: (_key: string, value: string) => {
    state.value = value;
  },
  deleteSessionStorage: () => {
    state.value = null;
  },
}));
const proof = {
  userId: 'user-a',
  accountId: 'account-a',
  nonce: 'change_00000000-0000-4000-8000-000000000001',
  plan: 'PRO' as const,
  period: 'month' as const,
  createdAt: 1_800_000_000_000,
};
beforeEach(() => {
  state.value = null;
  vi.setSystemTime(proof.createdAt);
});
describe('direct plan change proof', () => {
  it('accepts only the matching identity, nonce and unexpired operation', () => {
    expect(savePurchaseChangeProof(proof)).toBe(true);
    expect(readPurchaseChangeProof('user-a', 'account-a', proof.nonce)).toEqual(
      proof
    );
    expect(
      readPurchaseChangeProof('other', 'account-a', proof.nonce)
    ).toBeNull();
    expect(readPurchaseChangeProof('user-a', 'other', proof.nonce)).toBeNull();
    expect(
      readPurchaseChangeProof('user-a', 'account-a', 'change_wrong')
    ).toBeNull();
    vi.setSystemTime(proof.createdAt + 86_400_000);
    expect(
      readPurchaseChangeProof('user-a', 'account-a', proof.nonce)
    ).toBeNull();
    clearPurchaseChangeProof();
    expect(state.value).toBeNull();
  });
});
