import { SectionOrnamentMolecule } from '../../components/SectionOrnament/SectionOrnament.molecule';
import { LP_ASSETS } from '../../assets/lpAssets';
import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { BillingCurrency } from '@kernel/domain/localization/country.config';
import { formatMoney } from '@kernel/domain/pricing/money.format';
import { CheckIcon, XIcon } from '@phosphor-icons/react';
import {
  PLAN_FEATURE_NAMESPACE,
  PLAN_FEATURE_TABLE_ROWS,
  planFeatureCell,
} from '../../../application/pricing/plan-features.catalog';
import { TIERS } from './PricingPageData';
import type { PricingTier } from './PricingPageData';
import { usePricingPlans } from '../shared/pricing/hooks/usePricingPlans';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { PriceSlotAtom } from '../../components/PriceSlot/PriceSlot.atom';
import styles from './PricingPage.module.css';

type Translate = ReturnType<typeof useTranslations<'static.pricing'>>;
type FeatureTranslate = ReturnType<typeof useTranslations<'account.plan'>>;
type Plan = NonNullable<ReturnType<typeof usePricingPlans>['data']>[number];

/**
 * Renders a single feature cell value. Booleans become an accessible Check/X
 * glyph; strings (counts, "∞") render verbatim. Shared by the desktop table
 * cells and the mobile per-tier cards so the bool→glyph logic lives once.
 */
function FeatureValue({
  cell,
  t,
  tFeature,
}: {
  cell: ReturnType<typeof planFeatureCell>;
  t: Translate;
  tFeature: FeatureTranslate;
}): ReactNode {
  if (cell.kind === 'text') {
    return cell.text;
  }
  if (cell.kind === 'key') {
    return tFeature(cell.key, cell.params);
  }
  // Phosphor renders a <svg>; its `alt` prop emits a native <title> element,
  // the canonical accessible-name source for SVG (announced by screen readers
  // without needing role='img'). aria-label on a roleless <svg> is unreliable.
  return cell.included ? (
    <CheckIcon
      size={15}
      className={styles.tableCheck}
      weight='bold'
      role='img'
      alt={t('table.included')}
    />
  ) : (
    <XIcon
      size={15}
      className={styles.tableCross}
      weight='regular'
      role='img'
      alt={t('table.notIncluded')}
    />
  );
}

/**
 * Chip next to the tier name (desktop column header + mobile card head).
 * The recommended plan (Pro) reuses the card key above (`tierSection.popularBadge`);
 * other tiers with a `badgeKey` (Studio, "Dla zespołów") get an
 * informational chip in the same frozen-light language. The logic lives in one place,
 * like FeatureValue.
 */
function tierChip(
  tier: PricingTier,
  t: Translate,
  showsRecommendation: boolean
): ReactNode {
  const key = showsRecommendation ? 'tierSection.popularBadge' : tier.badgeKey;
  if (key == null) {
    return null;
  }
  return <span className={styles.colChip}>{t(key)}</span>;
}

/**
 * Dual-recommend (owner): the highlighted column = the recommended plan for SOLO
 * (Pro, isRecommended) OR the salon target (Studio, isTarget). The decoy pushes towards
 * Studio, so the table must highlight it too: the „Polecany" / „Dla zespołów" chips
 * tell the segment apart. Parity with the tier cards, where both get center-stage.
 */
const isFeaturedCol = (
  tier: PricingTier,
  showsRecommendation: boolean
): boolean => showsRecommendation || tier.isTarget === true;

/** Resolves the monthly / yearly price node for a tier (or "Kontakt"). */
function priceNode(
  tier: PricingTier,
  plan: Plan | undefined,
  field: 'priceMonthly' | 'priceYearly',
  isPending: boolean,
  t: Translate,
  currency: BillingCurrency | null,
  locale: string
): ReactNode {
  if (tier.isContact) {
    return t('table.contact');
  }
  return (
    <>
      <PriceSlotAtom
        value={plan?.[field] ?? null}
        isLoading={isPending}
        size='sm'
        locale={locale}
      />{' '}
      {currency?.toUpperCase()}
      {field === 'priceYearly' &&
        currency &&
        plan?.priceYearlyTotal != null && (
          <span>
            {' '}
            {t('table.yearlyTotal', {
              total: formatMoney(plan.priceYearlyTotal, currency, locale),
            })}
          </span>
        )}
    </>
  );
}

export function PricingComparisonTableOrganism({
  footer,
}: {
  /** Trust + Booksy anchor: the bottom of the comparison (owner). */
  footer?: ReactNode;
}) {
  const { data: plans, isPending, currency } = usePricingPlans();
  const locale = useLocale();
  // DECISION: the table follows the plan cards' rule that the user's current plan
  // beats the recommendation, so a stylist on Pro never sees "Polecany" on her own
  // plan's column after the card stopped showing it. (owner vote)
  const { data: currentUser } = useCurrentUserAccount();
  const currentPlan = currentUser?.stylist_account?.pricing_plan ?? null;
  const showsRec = (tier: PricingTier): boolean =>
    tier.isRecommended === true && currentPlan !== tier.planId;
  const t = useTranslations('static.pricing');
  // Rows = a projection of the feature catalog (application/pricing), not an own list.
  const tFeature = useTranslations(PLAN_FEATURE_NAMESPACE);

  const planFor = (planId: PricingTier['planId']): Plan | undefined =>
    plans?.find(p => p.id === planId);

  return (
    /* Embedded in the plans band (owner): the same surface
       as the cards, without a second Section (avoids a double pad-block). */
    <section
      className={styles.comparisonEmbed}
      aria-labelledby='pricing-compare-heading'>
      <header className={styles.comparisonHeader}>
        <SectionOrnamentMolecule src={LP_ASSETS.decor.staticPricingPlans}>
          <h2
            id='pricing-compare-heading'
            className={styles.comparisonHeadline}>
            {t('table.headline')}
          </h2>
        </SectionOrnamentMolecule>
      </header>

      {/* Desktop: semantic comparison table (>=768px) */}
      <div className={styles.tableWrapper}>
        <table className={styles.comparisonTable}>
          <thead>
            <tr>
              <th scope='col'>{t('table.featureLabel')}</th>
              {TIERS.map(tier => (
                <th
                  key={tier.id}
                  scope='col'
                  className={
                    isFeaturedCol(tier, showsRec(tier))
                      ? styles.highlightCol
                      : undefined
                  }>
                  <span className={styles.colName}>{t(tier.nameKey)}</span>
                  {tierChip(tier, t, showsRec(tier))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PLAN_FEATURE_TABLE_ROWS.map(row => (
              <tr key={row.id}>
                <th scope='row'>{tFeature(row.labelKey)}</th>
                {TIERS.map(tier => (
                  <td
                    key={tier.id}
                    className={
                      isFeaturedCol(tier, showsRec(tier))
                        ? styles.highlightCol
                        : undefined
                    }>
                    <FeatureValue
                      cell={planFeatureCell(row.id, tier.planId)}
                      t={t}
                      tFeature={tFeature}
                    />
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope='row'>{t('table.labelPriceMonthly')}</th>
              {TIERS.map(tier => (
                <td
                  key={tier.id}
                  className={
                    isFeaturedCol(tier, showsRec(tier))
                      ? styles.highlightCol
                      : undefined
                  }>
                  {priceNode(
                    tier,
                    planFor(tier.planId),
                    'priceMonthly',
                    isPending,
                    t,
                    currency,
                    locale
                  )}
                </td>
              ))}
            </tr>
            <tr>
              <th scope='row'>{t('table.labelPriceYearly')}</th>
              {TIERS.map(tier => (
                <td
                  key={tier.id}
                  className={
                    isFeaturedCol(tier, showsRec(tier))
                      ? styles.highlightCol
                      : undefined
                  }>
                  {priceNode(
                    tier,
                    planFor(tier.planId),
                    'priceYearly',
                    isPending,
                    t,
                    currency,
                    locale
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Mobile: one card per tier with a feature definition list (<768px) */}
      <ul className={styles.compareCards}>
        {TIERS.map(tier => {
          const plan = planFor(tier.planId);
          return (
            <li
              key={tier.id}
              className={
                isFeaturedCol(tier, showsRec(tier))
                  ? `${styles.compareCard} ${styles.compareCardRecommended}`
                  : styles.compareCard
              }>
              <div className={styles.compareCardHead}>
                <span className={styles.compareCardName}>
                  {t(tier.nameKey)}
                </span>
                {tierChip(tier, t, showsRec(tier))}
              </div>
              <div className={styles.compareCardPrice}>
                {priceNode(
                  tier,
                  plan,
                  'priceMonthly',
                  isPending,
                  t,
                  currency,
                  locale
                )}
              </div>
              <dl className={styles.compareCardList}>
                {PLAN_FEATURE_TABLE_ROWS.map(row => (
                  <div key={row.id} className={styles.compareRow}>
                    <dt>{tFeature(row.labelKey)}</dt>
                    <dd>
                      <FeatureValue
                        cell={planFeatureCell(row.id, tier.planId)}
                        t={t}
                        tFeature={tFeature}
                      />
                    </dd>
                  </div>
                ))}
                <div className={styles.compareRow}>
                  <dt>{t('table.labelPriceYearly')}</dt>
                  <dd>
                    {priceNode(
                      tier,
                      plan,
                      'priceYearly',
                      isPending,
                      t,
                      currency,
                      locale
                    )}
                  </dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
      {footer}
    </section>
  );
}
