import { useTranslations } from 'next-intl';
import type { CountryCode } from '@kernel/domain/localization/country.config';
import { usePricingPlans } from '../shared/pricing/hooks/usePricingPlans';
import { ButtonAtom } from '../../components/Button/Button.atom';
import styles from './PricingPage.module.css';

export function canUsePaidPricing(
  country: CountryCode | null,
  international: boolean,
  locked: boolean
): boolean {
  return locked || country === 'PL' || international;
}

export function PricingMarketMolecule() {
  const t = useTranslations('static.pricing');
  const {
    country,
    currency,
    isCurrencyLocked,
    internationalBillingEnabled,
    isMarketError,
    refetchMarket,
  } = usePricingPlans();
  if (isMarketError) {
    return <PricingMarketErrorMolecule onRetry={refetchMarket} />;
  }
  const available = canUsePaidPricing(
    country,
    internationalBillingEnabled,
    isCurrencyLocked
  );
  if (available && !isCurrencyLocked) {
    return null;
  }
  return (
    <div className={styles.market}>
      {isCurrencyLocked && currency && (
        <p>{t('marketLocked', { currency: currency.toUpperCase() })}</p>
      )}
      {!available && <p role='status'>{t('marketUnavailable')}</p>}
    </div>
  );
}

export function PricingMarketErrorMolecule({
  onRetry,
}: {
  onRetry: () => void | Promise<void>;
}) {
  const t = useTranslations('static.pricing');
  const buttons = useTranslations('buttons');
  return (
    <div role='alert'>
      <p>{t('marketLoadError')}</p>
      <ButtonAtom variant='outlined' onClick={() => void onRetry()}>
        {buttons('retry')}
      </ButtonAtom>
    </div>
  );
}
