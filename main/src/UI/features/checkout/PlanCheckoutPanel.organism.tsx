import { useTranslations } from 'next-intl';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { usePricingPlans } from '../shared/pricing/hooks/usePricingPlans';
import { ButtonAtom } from '../../components/Button/Button.atom';
import {
  PlanCheckoutSessionOrganism,
  type PlanCheckoutPanelProps,
} from './PlanCheckoutSession.organism';
import styles from './PlanCheckoutPanel.module.css';
import { ExistingSubscriptionRecoveryMolecule } from './ExistingSubscriptionRecovery.molecule';
import { useEffect, useState } from 'react';
import type {
  BillingCurrency,
  CountryCode,
} from '@kernel/domain/localization/country.config';
import type { BillingProfile } from '@kernel/domain/account/billing-profile.contract-schemas';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';

export function PlanCheckoutPanelOrganism(props: PlanCheckoutPanelProps) {
  const { data: user } = useCurrentUserAccount();
  if (props.planId === PricingPlanValue.FREE) {
    return <PlanCheckoutSessionOrganism {...props} />;
  }
  if (!user?.id) {
    return <div role='status'>{props.tx.preparing}</div>;
  }
  return (
    <PaidCheckoutPanel
      key={`${user.id}:${props.planId}:${props.billingPeriod}`}
      {...props}
    />
  );
}

type SessionMarket = {
  country: CountryCode | null;
  currency: BillingCurrency;
  profile: BillingProfile | undefined;
};

function PaidCheckoutPanel(props: PlanCheckoutPanelProps) {
  const t = useTranslations('static.pricing');
  const pay = useTranslations('account.pay');
  const market = usePricingPlans();
  const [snapshot, setSnapshot] = useState<SessionMarket | null>(null);
  const plan = market.data?.find(item => item.id === props.planId);
  const price =
    props.billingPeriod === 'year'
      ? plan?.priceYearlyTotal
      : plan?.priceMonthly;
  const unavailable =
    market.country !== 'PL' &&
    !market.isCurrencyLocked &&
    !market.internationalBillingEnabled;
  const ready =
    !market.isResolving &&
    !market.isPending &&
    !market.isCurrencyLocked &&
    !market.billingProfile.isError &&
    !market.isMarketError &&
    !market.isCurrencyUnavailable &&
    !market.isError &&
    !unavailable &&
    market.currency !== null &&
    price != null &&
    !market.pricesUnavailable;
  useEffect(() => {
    if (snapshot || !ready || !market.currency) {
      return;
    }
    setSnapshot({
      country: market.country,
      currency: market.currency,
      profile: market.billingProfile.data,
    });
  }, [
    snapshot,
    ready,
    market.country,
    market.currency,
    market.billingProfile.data,
  ]);
  if (snapshot) {
    const profile = market.billingProfile.data ?? snapshot.profile;
    const unverified =
      market.billingProfile.isError || market.billingProfile.isFetching;
    return (
      <div className={styles.panel}>
        {market.billingProfile.isError ? (
          <div role='alert'>
            <p>{pay('billingDetailsError')}</p>
            <ButtonAtom
              variant='outlined'
              onClick={() => void market.refetchMarket()}>
              {props.tx.retry}
            </ButtonAtom>
          </div>
        ) : market.billingProfile.isFetching ? (
          <div role='status'>{props.tx.preparing}</div>
        ) : null}
        <PlanCheckoutSessionOrganism
          {...props}
          currency={snapshot.currency}
          {...(snapshot.country && { billingCountry: snapshot.country })}
          {...(profile && { billingProfile: profile })}
          billingProfileUnverified={unverified}
        />
      </div>
    );
  }
  return (
    <div className={styles.panel}>
      {market.isResolving || market.isPending ? (
        <div role='status'>{props.tx.preparing}</div>
      ) : market.isCurrencyLocked ? (
        <ExistingSubscriptionRecoveryMolecule />
      ) : market.isMarketError ||
        market.billingProfile.isError ||
        market.isCurrencyUnavailable ||
        market.isError ? (
        <div role='alert'>
          <p>{props.tx.sessionError}</p>
          <ButtonAtom
            variant='outlined'
            onClick={() =>
              void (market.billingProfile.isError || market.isMarketError
                ? market.refetchMarket()
                : market.refetch())
            }>
            {props.tx.retry}
          </ButtonAtom>
        </div>
      ) : unavailable ? (
        <p role='status'>{t('marketUnavailable')}</p>
      ) : market.currency === null ||
        price == null ||
        market.pricesUnavailable ? (
        <p role='status'>{props.tx.sessionError}</p>
      ) : (
        <div role='status'>{props.tx.preparing}</div>
      )}
    </div>
  );
}

export type { PlanCheckoutPanelTranslations } from './PlanCheckoutSession.organism';
