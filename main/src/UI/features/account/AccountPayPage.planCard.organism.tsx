// UI/features/account/AccountPayPage.planCard.tsx
// PlanCard + sub-components — extracted from AccountPayPage.parts.tsx to keep
// both files under the 300 LOC ceiling.

import { useLocale, type useTranslations } from 'next-intl';
import {
  formatMinorAmount,
  formatMoney,
} from '@kernel/domain/pricing/money.format';
import type { BillingCurrency } from '@kernel/domain/localization/country.config';
import clsx from 'clsx';
import { freePlanSummaryParams } from '../../../application/pricing/plan-features.catalog';
import { CheckIcon } from '@phosphor-icons/react';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { ButtonAtom } from '../../components/Button/Button.atom';
import {
  PlanFeatureDisclosureOrganism,
  PlanFeatureListOrganism,
} from './AccountPayPage.planFeatures.organism';
import type { PricingPlanCard } from '../shared/pricing/hooks/usePricingPlans';
import styles from './AccountPayPage.module.css';

// DECISION: this card (management: current/upgrade/downgrade + trigger of the embedded checkout)
// deliberately stays surface-specific and does NOT migrate to a shared PlanCardShell. It shares with
// /pricing and onboarding only the genuinely shared foundation: `usePricingPlans` (data + icons),
// `pricingFunnelHref`, `groszToPln`. It differs on every other layer: (a) price display: big amount
// + PLN + cycle here, trial framing on /pricing (the offer is the hero, the price small print); (b)
// CTA semantics: a <button> onClick running an in-app action (portal/checkout/downgrade gate) here,
// a <Link> in the login→pay funnel on /pricing; (c) feature list: check icons from `plan.features`
// (string[]) here, hairline rows on /pricing; both lists project the same feature catalog
// (application/pricing/plan-features.catalog). Unifying the shell would break parity on each axis.
// The data foundation IS already shared: that is the right boundary, not a God-component.

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
  featuresShow: string;
  featuresHide: string;
  /** Said under a plan's button when the change to it failed. */
  changeError: string;
  taglineFor: (planId: PricingPlan) => string;
}

type TranslateFn = ReturnType<typeof useTranslations<'account.pay'>>;

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
        return t('taglineFree', freePlanSummaryParams());
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
    featuresShow: t('featuresShow'),
    featuresHide: t('featuresHide'),
    changeError: t('planChangeError'),
    taglineFor,
  };
}

/* ============================================================
 *  PLAN CARD
 * ============================================================ */

interface PlanCardProps {
  currency: BillingCurrency;
  billingChangeLabel?: string | undefined;
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
  currency,
  billingChangeLabel,
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
  const showPopular = isRecommended && !isCurrent;

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
        <PlanPrice
          plan={plan}
          price={price}
          cycle={billingCycle}
          tx={tx}
          currency={currency}
        />
      </div>

      {isCurrent ? (
        <PlanFeatureListOrganism features={plan.features} />
      ) : (
        <PlanFeatureDisclosureOrganism
          features={plan.features}
          showLabel={tx.featuresShow}
          hideLabel={tx.featuresHide}
        />
      )}

      {(!isCurrent || billingChangeLabel !== undefined) && (
        <div className={styles.planAction}>
          <PlanCardCTA
            billingChangeLabel={billingChangeLabel}
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
  currency: BillingCurrency;
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
function PlanPrice({ plan, price, cycle, tx, currency }: PlanPriceProps) {
  const locale = useLocale();
  const isCustom = plan.isCustom === true;
  const isPaid = !isCustom && price !== null && price > 0;
  return (
    <div className={styles.planPriceBlock}>
      <div className={styles.planPrice}>
        {isCustom ? (
          <span className={styles.planPriceCustom}>{tx.priceCustom}</span>
        ) : price === null ? (
          // Degraded (Stripe fallback): the paid plan's price is unknown. Show a
          // typographic minus (U+2212), NEVER "0 PLN" (null is not free).
          <span className={styles.planPriceAmount}>−</span>
        ) : (
          <>
            <span className={styles.planPriceAmount}>
              {formatMinorAmount(price, locale)}
            </span>
            <span className={styles.planPriceCurrency}>
              {currency.toUpperCase()}
            </span>
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
        {cycle === 'yearly' && plan.priceYearlyTotal != null
          ? ` (${formatMoney(plan.priceYearlyTotal, currency, locale)})`
          : ''}
      </span>
    </div>
  );
}

interface PlanCardCTAProps {
  billingChangeLabel?: string | undefined;
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
  billingChangeLabel,
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
      disabled={
        disableActions ||
        isPending ||
        (plan.id !== PricingPlanValue.FREE &&
          (plan.priceMonthly === null || plan.priceYearly === null))
      }
      loading={isPending}>
      {billingChangeLabel ??
        (isDowngrade ? tx.ctaDowngrade(plan.name) : tx.ctaUpgrade(plan.name))}
    </ButtonAtom>
  );
}
