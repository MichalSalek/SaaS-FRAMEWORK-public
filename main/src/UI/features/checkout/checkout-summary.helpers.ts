// UI/features/checkout/checkout-summary.helpers.ts
//
// Turns the live Stripe Checkout Session (custom UI mode) into what the last
// step before payment says. Pure: no React, no i18n, no formatting of money
// (every amount string is Stripe's own, locale-correct `amount`).
//
// DECISION: a session that starts a trial carries TWO different charges and they must never share
// one table. `session.total` is what is charged TODAY (zero while a trial starts);
// `session.recurring.dueNext` is the recurring charge (the first payment after the trial). The
// summary once labeled `total.subtotal` as net next to the VAT and
// gross of today's zero charge ("Netto 179,00 zł / VAT 23% 0,00 zł / Brutto 0,00 zł"), which the
// owner read as a glitch. Each block below takes all its figures from ONE of the two objects, and a
// block whose figures do not add up is not shown as a breakdown at all. (owner)

import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';

interface StripeAmount {
  minorUnitsAmount: number;
  amount: string;
}

interface ChargeParts {
  subtotal: StripeAmount;
  discount: StripeAmount;
  taxExclusive: StripeAmount;
  taxInclusive: StripeAmount;
  total: StripeAmount;
}

/** The slice of `StripeCheckoutSession` the summary reads (structural). */
export interface CheckoutSummarySource {
  total: ChargeParts;
  recurring: {
    interval: string;
    dueNext: ChargeParts;
    trial: { trialEnd: number; trialPeriodDays: number } | null;
  } | null;
  discountAmounts: ReadonlyArray<{
    displayName: string;
    recurring:
      | { type: 'forever' }
      | { type: 'repeating'; durationInMonths: number }
      | null;
  }> | null;
}

export type DiscountDuration =
  { type: 'once' } | { type: 'forever' } | { type: 'months'; months: number };

export interface SummaryDiscount {
  /** Stripe's formatted discount amount, always shown with a leading minus. */
  amount: string;
  /** The coupon's name; null when the session does not name it. */
  name: string | null;
  duration: DiscountDuration | null;
}

export type ChargeFigure =
  | {
      kind: 'inclusive';
      beforeDiscountGross: string;
      discount: SummaryDiscount | null;
      vat: string;
      vatRatePercent: number | null;
      gross: string;
    }
  | {
      kind: 'breakdown';
      net: string;
      discount: SummaryDiscount | null;
      vat: string;
      /** Whole-percent rate DERIVED from Stripe's own amounts; null = unknown. */
      vatRatePercent: number | null;
      gross: string;
    }
  /** The total is known, but net and VAT do not add up to it: show it alone. */
  | { kind: 'gross-only'; gross: string }
  | { kind: 'unavailable' };

export type CheckoutSummaryModel =
  | {
      kind: 'trial';
      /** What is charged today (Stripe's figure, zero for a trial). */
      todayGross: string;
      trialEndsAt: Date;
      trialDays: number;
      /** The first payment after the trial = the recurring charge. */
      next: ChargeFigure;
      interval: BillingPeriod;
    }
  | {
      kind: 'pay';
      today: ChargeFigure;
      /** The recurring charge after today's, when Stripe states it. */
      nextGross: string | null;
      interval: BillingPeriod;
    };

const MINUS = '−';

function isAmount(value: StripeAmount | undefined): value is StripeAmount {
  return (
    value !== undefined &&
    typeof value.amount === 'string' &&
    value.amount !== '' &&
    Number.isFinite(value.minorUnitsAmount)
  );
}

function withMinus(amount: string): string {
  const bare = amount.replace(/^[-−]\s*/, '');
  return `${MINUS}${bare}`;
}

/**
 * The rate is read back from Stripe's amounts (VAT over the taxed base) and
 * accepted only when a whole percent reproduces the VAT to one minor unit.
 * No rate is hardcoded here: a changed tax rate changes the label by itself.
 */
function deriveVatRatePercent(base: number, vat: number): number | null {
  if (base <= 0 || vat <= 0) {
    return null;
  }
  const rate = Math.round((vat * 100) / base);
  return Math.abs(Math.round((base * rate) / 100) - vat) <= 1 ? rate : null;
}

function resolveDiscount(
  parts: ChargeParts,
  source: CheckoutSummarySource
): SummaryDiscount | null {
  if (Math.abs(parts.discount.minorUnitsAmount) === 0) {
    return null;
  }
  const first = source.discountAmounts?.[0];
  const duration: DiscountDuration | null =
    first === undefined
      ? null
      : first.recurring === null
        ? { type: 'once' }
        : first.recurring.type === 'forever'
          ? { type: 'forever' }
          : { type: 'months', months: first.recurring.durationInMonths };
  const name = first?.displayName.trim() ?? '';
  return {
    amount: withMinus(parts.discount.amount),
    name: name === '' ? null : name,
    duration,
  };
}

function resolveCharge(
  parts: ChargeParts | undefined,
  source: CheckoutSummarySource,
  /** Today's charge may honestly be zero; a recurring charge may not. */
  zeroTotalIsValid: boolean
): ChargeFigure {
  if (
    parts === undefined ||
    !isAmount(parts.subtotal) ||
    !isAmount(parts.discount) ||
    !isAmount(parts.taxExclusive) ||
    !isAmount(parts.taxInclusive) ||
    !isAmount(parts.total)
  ) {
    return { kind: 'unavailable' };
  }
  const net = parts.subtotal.minorUnitsAmount;
  const discount = Math.abs(parts.discount.minorUnitsAmount);
  const vat = parts.taxExclusive.minorUnitsAmount;
  const total = parts.total.minorUnitsAmount;
  const includedVat = parts.taxInclusive.minorUnitsAmount;
  const base = net - discount;

  // With inclusive prices subtotal and discount are GROSS. Keep Stripe's own
  // amounts and label the included VAT instead of inventing a net subtotal.
  if (vat === 0 && base === total && includedVat >= 0 && includedVat <= total) {
    return {
      kind: 'inclusive',
      beforeDiscountGross: parts.subtotal.amount,
      discount: resolveDiscount(parts, source),
      vat: parts.taxInclusive.amount,
      vatRatePercent: deriveVatRatePercent(total - includedVat, includedVat),
      gross: parts.total.amount,
    };
  }
  if (includedVat !== 0) {
    return total > 0 || zeroTotalIsValid
      ? { kind: 'gross-only', gross: parts.total.amount }
      : { kind: 'unavailable' };
  }

  if (base + vat === total) {
    // A zero recurring charge is real only when a discount covers the plan.
    if (total === 0 && net > 0 && discount < net && !zeroTotalIsValid) {
      return { kind: 'unavailable' };
    }
    return {
      kind: 'breakdown',
      net: parts.subtotal.amount,
      discount: resolveDiscount(parts, source),
      vat: parts.taxExclusive.amount,
      vatRatePercent: deriveVatRatePercent(base, vat),
      gross: parts.total.amount,
    };
  }
  if (total > 0 || zeroTotalIsValid) {
    return { kind: 'gross-only', gross: parts.total.amount };
  }
  return { kind: 'unavailable' };
}

export function buildCheckoutSummaryModel(
  source: CheckoutSummarySource,
  fallbackInterval: BillingPeriod
): CheckoutSummaryModel {
  const recurring = source.recurring;
  const interval: BillingPeriod =
    recurring?.interval === 'year'
      ? 'year'
      : recurring?.interval === 'month'
        ? 'month'
        : fallbackInterval;
  const trial = recurring?.trial ?? null;

  if (recurring !== null && trial !== null && trial.trialEnd > 0) {
    return {
      kind: 'trial',
      todayGross: source.total.total.amount,
      trialEndsAt: new Date(trial.trialEnd * 1000),
      trialDays: trial.trialPeriodDays,
      next: resolveCharge(recurring.dueNext, source, false),
      interval,
    };
  }

  const next = resolveCharge(recurring?.dueNext, source, false);
  return {
    kind: 'pay',
    today: resolveCharge(source.total, source, true),
    nextGross: next.kind === 'unavailable' ? null : next.gross,
    interval,
  };
}
