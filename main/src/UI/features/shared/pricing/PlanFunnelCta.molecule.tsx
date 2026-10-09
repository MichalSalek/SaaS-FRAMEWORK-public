import type { ReactNode } from 'react';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import {
  trackPricingPlanClicked,
  type CtaLocation,
} from '../../../../application/analytics/cta-events';
import { LinkButtonAtom } from '../../../components/Button/LinkButton.atom';
import { usePricingFunnelState } from '../../../shared/hooks/usePricingFunnelState';
import { buildPlanLoginHref } from './pricingFunnelHref';

interface PlanFunnelCtaProps {
  planId: PricingPlan;
  label: ReactNode;
  /** Okres rozliczeniowy niesiony do /pay. Mini-cenniki LP pokazują ceny
   *  MIESIĘCZNE (owner 2026-09-02), więc domyślnie 'month' — ta sama kwota
   *  i ten sam okres, co po kliknięciu. */
  billingPeriod?: BillingPeriod;
  variant?: 'primary' | 'outlined';
  /** Klasa wrappera <Link> (per-strona: full-width slot). */
  className?: string;
  /** Klasa <button> (per-strona: full-width). */
  buttonClassName?: string;
  /**
   * Miejsce CTA w serwisie — wymagane, bo ta sama molekuła stoi w mini-cenniku
   * na dwóch różnych stronach. Bez tego w raporcie zlewają się w jeden wiersz
   * i nie widać, który mini-cennik faktycznie sprzedaje.
   */
  ctaLocation: CtaLocation;
}

/**
 * Per-plan CTA wpięte w login→pay funnel — współdzielone przez mini-cenniki LP
 * (for-stylists, for-studios), żeby wiring funnela (href + funnel-intent) żył w
 * JEDNYM miejscu (S44, reużywalność bez pełnej unifikacji kart planów).
 *
 * DECISION (nie usuwaj tego komentarza):
 * planId niesiony do /pay przez sessionStorage (`setPricingFunnel` onClick), bo
 * login-302 na `from` gubi query URL-a logowania. Href = account-route →
 * web-login-first na każdym viewporcie, bez /get-app bounce.
 * Główny cennik /pricing NIE używa tej molekuły — ma bogatszy, plan-aware CTA
 * (current/switch/disabled) — ale dzieli TEN SAM `buildPlanLoginHref` (SSOT).
 */
export function PlanFunnelCtaMolecule({
  planId,
  label,
  billingPeriod = 'month',
  variant = 'primary',
  className = '',
  buttonClassName = '',
  ctaLocation,
}: PlanFunnelCtaProps) {
  const { setPricingFunnel } = usePricingFunnelState();
  // Jeden element interaktywny: <a> stylizowany jak przycisk (LinkButtonAtom).
  // Wcześniej <Link><ButtonAtom/></Link> = <a><button>, nieprawidłowe zagnieżdżenie
  // (podwójny tab-stop, czytnik ogłaszał link ORAZ przycisk).
  return (
    <span className={className}>
      <LinkButtonAtom
        href={buildPlanLoginHref(planId, billingPeriod)}
        variant={variant}
        size='md'
        className={buttonClassName}
        onClick={() => {
          trackPricingPlanClicked(planId, billingPeriod, ctaLocation);
          setPricingFunnel({ planId, billingPeriod });
        }}>
        {label}
      </LinkButtonAtom>
    </span>
  );
}
