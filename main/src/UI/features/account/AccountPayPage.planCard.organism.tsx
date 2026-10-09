// UI/features/account/AccountPayPage.planCard.tsx
// PlanCard + sub-components — extracted from AccountPayPage.parts.tsx to keep
// both files under the 300 LOC ceiling.

import clsx from 'clsx';
import { CheckIcon } from '@phosphor-icons/react';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { ButtonAtom } from '../../components/Button/Button.atom';
import type { PricingPlanCard } from '../shared/pricing/hooks/usePricingPlans';
import { groszToPln } from '../shared/pricing/pricingFormat';
import styles from './AccountPayPage.module.css';

// DECISION (nie usuwaj tego komentarza):
// Ta karta (management: current/upgrade/downgrade + trigger embedded checkout)
// CELOWO zostaje surface-specific, nie migruje na wspólny PlanCardShell. Dzieli
// z /pricing i onboardingiem JEDYNIE genuine-shared fundament: `usePricingPlans`
// (dane + ikony), `pricingFunnelHref`, `groszToPln`. Różni się ze WSZYSTKICH
// pozostałych warstw: (a) wyświetlanie ceny — tu duża kwota+PLN+cykl, na
// /pricing trial-framing (oferta bohaterem, cena małym drukiem); (b) semantyka
// CTA — tu <button> onClick uruchamiający akcję in-app (portal/checkout/downgrade
// gate), na /pricing <Link> w login→pay funnel; (c) lista cech — tu check-ikony
// z `plan.features` (string[]), na /pricing hairline-wiersze z getTierFeatureResults
// (kumulatywne diffy i18n). Unifikacja shella złamałaby parytet każdej z tych
// osi (patrz raport S46). Fundament danych JEST już wspólny — to jest właściwa
// granica, nie God-component.

/* ============================================================
 *  Re-exported translation shape (consumers import from here)
 * ============================================================ */

export interface PlanTranslations {
  popularBadge: string;
  currentBadge: string;
  priceCustom: string;
  pricePerMonth: string;
  ctaContact: string;
  ctaUpgrade: (name: string) => string;
  ctaDowngrade: (name: string) => string;
  yearlyHint: string;
  /** Said under a plan's button when the change to it failed. */
  changeError: string;
  taglineFor: (planId: PricingPlan) => string;
}

/** Minimal next-intl `t` shape — accepts a key and optional interpolation. */
type TranslateFn = (key: string, values?: Record<string, string>) => string;

/** Exhaustiveness guard for the plan switch: `never` param = compile error if a
 *  PricingPlan member is unhandled; returns '' at runtime (unreachable). */
const assertUnreachableTagline = (_plan: never): string => '';

/**
 * Build the i18n-dumb PlanTranslations bag from the `account.pay` namespace.
 * Extracted from the composition to keep that file under the 300 LOC ceiling.
 */
export function buildPlanTx(t: TranslateFn): PlanTranslations {
  const taglineFor = (planId: PricingPlan): string => {
    switch (planId) {
      case PricingPlanValue.FREE:
        return t('taglineFree');
      case PricingPlanValue.PRO:
        return t('taglinePro');
      case PricingPlanValue.PRO_PLUS:
        return t('taglineProPlus');
      case PricingPlanValue.STUDIO:
        return t('taglineStudio');
      case PricingPlanValue.SCALE:
        return t('taglineScale');
      default:
        // Exhaustive over PricingPlan — a new plan forces a COMPILE error here
        // (never-assignment). Runtime returns '' (a `satisfies never` would be
        // erased and leak the raw id, so the empty string is explicit).
        return assertUnreachableTagline(planId);
    }
  };
  return {
    popularBadge: t('popularBadge'),
    currentBadge: t('currentLabel'),
    priceCustom: t('priceCustom'),
    pricePerMonth: t('pricePerMonth'),
    ctaContact: t('ctaContact'),
    ctaUpgrade: name => t('ctaUpgrade', { name }),
    ctaDowngrade: name => t('ctaDowngrade', { name }),
    yearlyHint: t('yearlyHint'),
    changeError: t('planChangeError'),
    taglineFor,
  };
}

/* ============================================================
 *  PLAN CARD
 * ============================================================ */

interface PlanCardProps {
  /** The last change to THIS plan failed: said under its button. */
  hasError: boolean;
  plan: PricingPlanCard;
  isCurrent: boolean;
  isDowngrade: boolean;
  /** The one card whose button is filled (resolveRecommendedPlanId). */
  isRecommended: boolean;
  billingCycle: 'monthly' | 'yearly';
  /** This card's own action is in flight. */
  isPending: boolean;
  disableActions: boolean;
  onManage: (id: PricingPlan) => void;
  onContactSales: () => void;
  tx: PlanTranslations;
}

export function PlanCardOrganism({
  plan,
  isCurrent,
  isDowngrade,
  isRecommended,
  billingCycle,
  isPending,
  disableActions,
  hasError,
  onManage,
  onContactSales,
  tx,
}: PlanCardProps) {
  const Icon = plan.icon;
  const price =
    billingCycle === 'monthly' ? plan.priceMonthly : plan.priceYearly;
  const showPopular = plan.isPopular === true && !isCurrent;

  return (
    <article
      className={clsx(styles.planCard, {
        [styles.planCardPopular ?? '']: showPopular,
        [styles.planCardRecommended ?? '']: isRecommended,
        [styles.planCardCustom ?? '']: plan.isCustom === true,
      })}
      aria-current={isCurrent ? 'true' : undefined}>
      <div className={styles.planHeader}>
        <div className={styles.planNameRow}>
          <span className={styles.planIconHalo} aria-hidden='true'>
            <Icon size={20} weight='duotone' />
          </span>
          <span className={styles.planName}>{plan.name}</span>
          {/* The badge sits IN the name row. It used to hang over the card's
              top edge, and the current plan was then said a second time by a
              disabled grey button at the bottom of the same card. */}
          {isCurrent ? (
            <span className={clsx(styles.planBadge, styles.planBadgeCurrent)}>
              <CheckIcon size={14} weight='bold' aria-hidden='true' />
              {tx.currentBadge}
            </span>
          ) : showPopular ? (
            <span className={clsx(styles.planBadge, styles.planBadgePopular)}>
              {tx.popularBadge}
            </span>
          ) : null}
        </div>
        <p className={styles.planTagline}>{tx.taglineFor(plan.id)}</p>
        <PlanPrice plan={plan} price={price} cycle={billingCycle} tx={tx} />
      </div>

      <ul className={styles.featureList}>
        {plan.features.map(feature => (
          <li key={feature} className={styles.featureItem}>
            <CheckIcon
              size={16}
              weight='bold'
              className={styles.featureCheck}
              aria-hidden='true'
            />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      {!isCurrent && (
        <div className={styles.planAction}>
          <PlanCardCTA
            plan={plan}
            isDowngrade={isDowngrade}
            isRecommended={isRecommended}
            isPending={isPending}
            disableActions={disableActions}
            onManage={onManage}
            onContactSales={onContactSales}
            tx={tx}
          />
          {hasError && (
            <p className={styles.actionError} role='alert'>
              {tx.changeError}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

interface PlanPriceProps {
  plan: PricingPlanCard;
  price: number | null;
  cycle: 'monthly' | 'yearly';
  tx: PlanTranslations;
}

// The whole price is ONE unbreakable line (amount, currency, period): the
// yearly variant used to read „/mies. (rocznie)” and pushed the period to a
// second line in narrow cards; „rocznie” is now said once, by the note under
// the price. That note is ALWAYS mounted (hidden when it does not apply), so
// switching the billing period moves nothing and cards stay level in a grid.
function PlanPrice({ plan, price, cycle, tx }: PlanPriceProps) {
  const isCustom = plan.isCustom === true;
  const isPaid = !isCustom && price !== null && price > 0;
  return (
    <div className={styles.planPriceBlock}>
      <div className={styles.planPrice}>
        {isCustom ? (
          <span className={styles.planPriceCustom}>{tx.priceCustom}</span>
        ) : price === null ? (
          // Degraded (fallback Stripe, S26): cena płatnego planu nieznana,
          // minus typograficzny (U+2212), NIGDY "0 PLN" (null ≠ darmowy).
          <span className={styles.planPriceAmount}>−</span>
        ) : (
          <>
            <span className={styles.planPriceAmount}>
              {isPaid ? groszToPln(price) : '0'}
            </span>
            <span className={styles.planPriceCurrency}>PLN</span>
            {isPaid && (
              <span className={styles.planPriceCycle}>{tx.pricePerMonth}</span>
            )}
          </>
        )}
      </div>
      <span
        className={styles.planPriceYearlyHint}
        data-visible={(isPaid && cycle === 'yearly') || undefined}
        aria-hidden={!(isPaid && cycle === 'yearly')}>
        {tx.yearlyHint}
      </span>
    </div>
  );
}

interface PlanCardCTAProps {
  plan: PricingPlanCard;
  isDowngrade: boolean;
  isRecommended: boolean;
  isPending: boolean;
  disableActions: boolean;
  onManage: (id: PricingPlan) => void;
  onContactSales: () => void;
  tx: PlanTranslations;
}

// One fill on the screen: the recommended step. Every other plan is outlined
// (a standalone action is never bare text; the downgrade used to be a ghost
// label with the weight of nothing). While a card's action is in flight its
// button keeps its variant, label and width and only gains the spinner.
function PlanCardCTA({
  plan,
  isDowngrade,
  isRecommended,
  isPending,
  disableActions,
  onManage,
  onContactSales,
  tx,
}: PlanCardCTAProps) {
  if (plan.isCustom === true) {
    return (
      <ButtonAtom
        variant='outlined'
        size='lg'
        className={styles.planBtn}
        onClick={onContactSales}>
        {tx.ctaContact}
      </ButtonAtom>
    );
  }
  return (
    <ButtonAtom
      variant={isRecommended ? 'primary' : 'outlined'}
      size='lg'
      className={styles.planBtn}
      onClick={() => onManage(plan.id)}
      disabled={disableActions || isPending}
      loading={isPending}>
      {isDowngrade ? tx.ctaDowngrade(plan.name) : tx.ctaUpgrade(plan.name)}
    </ButtonAtom>
  );
}
