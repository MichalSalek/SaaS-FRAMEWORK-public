import { randomUUID } from 'crypto';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';

/**
 * DECISION: the quote map lives on globalThis. Next bundles a module imported from
 * pages/api separately per route, so a module-level Map in the GET preview handler
 * would be invisible to the POST confirm handler. No database row and no new secret.
 */
const STORE_KEY = '__nfPlanChangeQuoteStore';

export const PLAN_CHANGE_QUOTE_TTL_MS = 5 * 60 * 1000;
export const PLAN_CHANGE_QUOTE_LIMIT = 500;

export type PlanChangeQuote = {
  quoteId: string;
  accountId: string;
  subscriptionId: string;
  targetPlanId: PricingPlan;
  targetPriceId: string;
  billingPeriod: BillingPeriod;
  fingerprint: string;
  prorationDate: number;
  amountDue: number;
  total: number;
  taxAmount: number | null;
  currency: string;
  expiresAt: number;
  resultInvoiceId?: string;
};

export type NewPlanChangeQuote = Omit<PlanChangeQuote, 'quoteId' | 'expiresAt'>;

type QuoteGlobal = typeof globalThis & {
  [STORE_KEY]?: Map<string, PlanChangeQuote>;
};

const quoteMap = (): Map<string, PlanChangeQuote> => {
  const scope = globalThis as QuoteGlobal;
  return (scope[STORE_KEY] ??= new Map<string, PlanChangeQuote>());
};

const evict = (map: Map<string, PlanChangeQuote>, nowMs: number): void => {
  for (const [quoteId, quote] of map) {
    if (quote.expiresAt <= nowMs) {
      map.delete(quoteId);
    }
  }
  while (map.size >= PLAN_CHANGE_QUOTE_LIMIT) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) {
      return;
    }
    map.delete(oldest);
  }
};

export const savePlanChangeQuote = (
  input: NewPlanChangeQuote,
  nowMs: number = Date.now()
): PlanChangeQuote => {
  const map = quoteMap();
  evict(map, nowMs);
  const quote: PlanChangeQuote = {
    ...input,
    quoteId: randomUUID(),
    expiresAt: nowMs + PLAN_CHANGE_QUOTE_TTL_MS,
  };
  map.set(quote.quoteId, quote);
  return quote;
};

/** Returns the record even after expiry so the caller can say `expired`. */
export const readPlanChangeQuote = (quoteId: string): PlanChangeQuote | null =>
  quoteMap().get(quoteId) ?? null;

export const clearPlanChangeQuoteStore = (): void => {
  delete (globalThis as QuoteGlobal)[STORE_KEY];
};
