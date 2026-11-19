import type { useTranslations } from 'next-intl';
import {
  formatMinorAmount,
  formatMoney,
} from '@kernel/domain/pricing/money.format';
import type { BillingCurrency } from '@kernel/domain/localization/country.config';
import type { PricingPlanCard } from '../../shared/pricing/hooks/usePricingPlans';
import type { BillingCycle } from '../../../components/BillingToggle/BillingToggle.molecule';
import { useCurrentLang } from '../../../hooks/useCurrentLang';
import styles from './OnboardingPlanChooser.module.css';

/* ── Price block. FREE => "0 zł"; null (Stripe fallback) => U+2212, never free. ── */

export function PriceBlockMolecule({
  plan,
  cycle,
  t,
  currency,
}: {
  plan: PricingPlanCard;
  cycle: BillingCycle;
  t: ReturnType<typeof useTranslations<'pages.onboarding'>>;
  currency: BillingCurrency | null;
}) {
  const lang = useCurrentLang();
  if (plan.isCustom === true) {
    return <span className={styles.priceCurrency}>{t('planPriceCustom')}</span>;
  }
  const price = cycle === 'monthly' ? plan.priceMonthly : plan.priceYearly;
  if (price === null) {
    // Parity with the real card: null price (Stripe unavailable) => U+2212,
    // never "0 zł" (null is not free).
    return <span className={styles.priceAmount}>{'−'}</span>;
  }
  const currencyCode = currency?.toUpperCase() ?? '';
  if (price === 0) {
    return (
      <>
        <span className={styles.priceAmount}>0</span>
        <span className={styles.priceCurrency}>{currencyCode}</span>
      </>
    );
  }
  return (
    <>
      <span className={styles.priceAmount}>
        {formatMinorAmount(price, lang)}
      </span>
      <span className={styles.priceCurrency}>{currencyCode}</span>
      <span className={styles.priceCycle}>
        {cycle === 'yearly'
          ? t('planPricePerMonthYearly')
          : t('planPricePerMonth')}
      </span>
      {cycle === 'yearly' && currency && plan.priceYearlyTotal != null && (
        <span className={styles.priceCycle}>
          {formatMoney(plan.priceYearlyTotal, currency, lang)}
        </span>
      )}
    </>
  );
}
