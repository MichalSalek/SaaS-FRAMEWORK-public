import { z } from 'zod';
import { TIME } from '@kernel/application/constants.config';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { STORAGE_KEYS } from './storage-keys.config';
import {
  getSessionStorage,
  setSessionStorage,
  deleteSessionStorage,
} from './session-storage-adapter/sessionStorage.adapter';

const proofSchema = z
  .object({
    userId: z.string().min(1),
    accountId: z.string().min(1),
    nonce: z.string().regex(/^change_[a-f0-9-]{36}$/),
    plan: z.enum(PricingPlanValue),
    period: z.enum(['month', 'year']),
    createdAt: z.number().finite(),
  })
  .strict();
export type PurchaseChangeProof = z.infer<typeof proofSchema>;
export function savePurchaseChangeProof(proof: PurchaseChangeProof): boolean {
  if (!proofSchema.safeParse(proof).success) {
    return false;
  }
  try {
    setSessionStorage(
      STORAGE_KEYS.PURCHASE_CHANGE_PROOF,
      JSON.stringify(proof)
    );
    return true;
  } catch {
    return false;
  }
}
export function readPurchaseChangeProof(
  userId: string,
  accountId: string,
  nonce: string
): PurchaseChangeProof | null {
  try {
    const value = getSessionStorage(STORAGE_KEYS.PURCHASE_CHANGE_PROOF);
    if (!value) {
      return null;
    }
    const result = proofSchema.safeParse(JSON.parse(value));
    if (
      !result.success ||
      result.data.userId !== userId ||
      result.data.accountId !== accountId ||
      result.data.nonce !== nonce ||
      result.data.createdAt > Date.now() ||
      Date.now() - result.data.createdAt >= TIME.MS_PER_DAY
    ) {
      return null;
    }
    return result.data;
  } catch {
    return null;
  }
}
export function clearPurchaseChangeProof(): void {
  try {
    deleteSessionStorage(STORAGE_KEYS.PURCHASE_CHANGE_PROOF);
  } catch {
    /* optional storage */
  }
}
