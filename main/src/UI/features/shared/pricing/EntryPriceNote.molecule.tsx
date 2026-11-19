import { useLocale, useTranslations } from 'next-intl';
import { formatMoney } from '@kernel/domain/pricing/money.format';
import {
  getPlanDisplayName,
  PricingPlanValue,
} from '@kernel/domain/pricing/pricing.config';
import { usePricingPlans, type PricingPlanCard } from './hooks/usePricingPlans';
import styles from './EntryPriceNote.module.css';

interface EntryPriceNoteProps {
  className?: string;
  /** A note about the cheap annual option. Only where there is room for two numbers. */
  withYearly?: boolean;
}

/**
 * The entry price under the CTA pair, written out plainly.
 *
 * The entry threshold is an argument FOR, not a footnote: the visitor will check
 * the price before deciding anyway, and if they must hunt for it some will not come
 * back. Same rule as the „plans from …” CTA on the client product pages: a pricing
 * button plus the amount next to it, in a readable face, not fine print.
 *
 * The amount comes from the LIVE pricing (Stripe -> /pricing/get-plans ->
 * usePricingPlans), never from a literal, so a marketing page cannot drift from
 * what checkout charges. When prices are unavailable (Stripe fallback, transport
 * error, loading) only the stable Free Demo label remains; no amount is guessed.
 */

/** The cheapest paid amounts stay in minor units; annual totals come directly from Stripe. */
export function selectEntryPrice(plans: readonly PricingPlanCard[]): {
  monthly: number;
  yearly: number | null;
  yearlyTotal: number | null;
} | null {
  const selfServe = plans.filter(
    plan => plan.id !== PricingPlanValue.FREE && !plan.isCustom
  );
  const monthly = selfServe
    .map(plan => plan.priceMonthly)
    .filter((price): price is number => price !== null && price > 0);
  if (monthly.length === 0) {
    return null;
  }
  const yearlyPlan = selfServe
    .filter(
      plan =>
        plan.priceYearly !== null &&
        plan.priceYearly > 0 &&
        plan.priceYearlyTotal != null &&
        plan.priceYearlyTotal > 0
    )
    .sort(
      (a, b) => (a.priceYearly ?? Infinity) - (b.priceYearly ?? Infinity)
    )[0];
  return {
    monthly: Math.min(...monthly),
    yearly: yearlyPlan?.priceYearly ?? null,
    yearlyTotal: yearlyPlan?.priceYearlyTotal ?? null,
  };
}

export function EntryPriceNoteMolecule({
  className,
  withYearly = false,
}: EntryPriceNoteProps) {
  const t = useTranslations('account.plan');
  const locale = useLocale();
  const { data, isPending, isError, pricesUnavailable, currency } =
    usePricingPlans();

  if (isPending || isError || pricesUnavailable || !data || currency === null) {
    return (
      <span className={`${styles.note} ${className ?? ''}`}>
        {getPlanDisplayName(PricingPlanValue.FREE)}
      </span>
    );
  }

  const entry = selectEntryPrice(data);
  if (entry === null) {
    return (
      <span className={`${styles.note} ${className ?? ''}`}>
        {getPlanDisplayName(PricingPlanValue.FREE)}
      </span>
    );
  }

  const yearly = withYearly ? entry.yearly : null;

  return (
    <span className={`${styles.note} ${className ?? ''}`}>
      {t('entryPriceNote', {
        price: formatMoney(entry.monthly, currency, locale),
      })}
      {yearly !== null && entry.yearlyTotal !== null && (
        <span className={styles.yearly}>
          {' '}
          {t('entryPriceYearly', {
            price: formatMoney(yearly, currency, locale),
            total: formatMoney(entry.yearlyTotal, currency, locale),
          })}
        </span>
      )}
    </span>
  );
}
