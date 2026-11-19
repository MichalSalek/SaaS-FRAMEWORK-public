import type { ReactNode } from 'react';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import {
  trackPricingPlanClicked,
  type CtaLocation,
} from '../../../../application/analytics/cta-events';
import { LinkButtonAtom } from '../../../components/Button/LinkButton.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { usePricingFunnelState } from '../../../shared/hooks/usePricingFunnelState';
import { buildPlanLoginHref } from './pricingFunnelHref';
import { usePricingMarket } from './hooks/usePricingMarket';

interface PlanFunnelCtaProps {
  planId: PricingPlan;
  label: ReactNode;
  /** Billing period carried to /pay. The LP mini-pricings show MONTHLY prices
   *  (owner), so the default is 'month': the same amount and the same period
   *  as after the click. */
  billingPeriod?: BillingPeriod;
  variant?: 'primary' | 'outlined';
  /** Class of the <Link> wrapper (per page: full-width slot). */
  className?: string;
  /** Class of the <button> (per page: full-width). */
  buttonClassName?: string;
  /**
   * Where in the site the CTA stands: required, because the same molecule stands in the
   * mini-pricing on two different pages. Without it the report merges them into one
   * row and you cannot see which mini-pricing actually sells.
   */
  ctaLocation: CtaLocation;
  disabled?: boolean;
}

export function PlanFunnelCtaMolecule({
  planId,
  label,
  billingPeriod = 'month',
  variant = 'primary',
  className = '',
  buttonClassName = '',
  ctaLocation,
  disabled = false,
}: PlanFunnelCtaProps) {
  const { setPricingFunnel } = usePricingFunnelState();
  const { country, currency } = usePricingMarket();
  // One interactive element: an <a> styled as a button (LinkButtonAtom).
  // Before, <Link><ButtonAtom/></Link> = <a><button>, invalid nesting (a double
  // tab stop, the reader announced a link AND a button).
  return (
    <span className={className}>
      {disabled ? (
        <ButtonAtom
          variant={variant}
          size='md'
          className={buttonClassName}
          disabled>
          {label}
        </ButtonAtom>
      ) : (
        <LinkButtonAtom
          href={buildPlanLoginHref(planId, billingPeriod)}
          variant={variant}
          size='md'
          className={buttonClassName}
          onClick={() => {
            trackPricingPlanClicked(planId, billingPeriod, ctaLocation, {
              billingCountry: country,
              currency,
            });
            setPricingFunnel({
              planId,
              billingPeriod,
              ...(country && { billingCountry: country }),
              ...(currency && { currency }),
            });
          }}>
          {label}
        </LinkButtonAtom>
      )}
    </span>
  );
}
