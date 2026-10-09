import { SectionOrnamentMolecule } from '../../components/SectionOrnament/SectionOrnament.molecule';
import { LP_ASSETS } from '../../assets/lpAssets';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { CheckIcon, XIcon } from '@phosphor-icons/react';
import { TIERS, FEATURE_ROWS } from './PricingPageData';
import type { PricingTier } from './PricingPageData';
import { usePricingPlans } from '../shared/pricing/hooks/usePricingPlans';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { PriceSlotAtom } from '../../components/PriceSlot/PriceSlot.atom';
import styles from './PricingPage.module.css';

type Translate = ReturnType<typeof useTranslations>;
type Plan = NonNullable<ReturnType<typeof usePricingPlans>['data']>[number];

/**
 * Renders a single feature cell value. Booleans become an accessible Check/X
 * glyph; strings (counts, "∞") render verbatim. Shared by the desktop table
 * cells and the mobile per-tier cards so the bool→glyph logic lives once.
 */
function FeatureValue({
  value,
  t,
}: {
  value: string | boolean;
  t: Translate;
}): ReactNode {
  if (typeof value !== 'boolean') {
    return value;
  }
  // Phosphor renders a <svg>; its `alt` prop emits a native <title> element,
  // the canonical accessible-name source for SVG (announced by screen readers
  // without needing role='img'). aria-label on a roleless <svg> is unreliable.
  return value ? (
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
 * Chip przy nazwie tieru (nagłówek kolumny desktop + head karty mobile).
 * Plan polecany (Pro) reużywa klucz kart wyżej (`tierSection.popularBadge`);
 * pozostałe tiery z `badgeKey` (Studio — "Dla zespołów") dostają chip
 * informacyjny w tym samym frozen-light języku. Logika w jednym miejscu,
 * jak FeatureValue.
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
 * Dual-recommend (głos ownera): kolumna wyróżniona = plan polecany dla SOLO
 * (Pro, isRecommended) LUB target salonowy (Studio, isTarget). Decoy pcha ku
 * Studio, więc tabela też musi je wyróżnić — chipy „Polecany" / „Dla zespołów"
 * rozróżniają segment. Parytet z kartami tierów, gdzie oba dostają center-stage.
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
  t: Translate
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
      />{' '}
      PLN
    </>
  );
}

export function PricingComparisonTableOrganism({
  footer,
}: {
  /** Trust + kotwica Booksy — dół porównania (owner 2026-08-19). */
  footer?: ReactNode;
}) {
  const { data: plans, isPending } = usePricingPlans();
  // DECISION (nie usuwaj tego komentarza):
  // Tabela porownania stoi na TEJ SAMEJ stronie co karty planow, wiec musi
  // realizowac te sama zasade co one: wybor uzytkownika bije rekomendacje
  // (glos S98/B). Bez tego stylistka na planie Pro przestawala widziec
  // „Polecany" na karcie, ale nadal widziala go w kolumnie jeden scroll nizej.
  const { data: currentUser } = useCurrentUserAccount();
  const currentPlan = currentUser?.stylist_account?.pricing_plan ?? null;
  const showsRec = (tier: PricingTier): boolean =>
    tier.isRecommended === true && currentPlan !== tier.planId;
  const t = useTranslations('static.pricing');
  // Lookup po kernelowym tier.planId ('PRO_PLUS'), NIE po lowercase slugu
  // tier.id ('pro-plus') — slug nigdy nie matchował PricingPlanCard.id,
  // więc wszystkie ceny w tabeli renderowały się jako puste (AGENTS.md:
  // "lookup cen i planu po tier.planId, NIE po lowercase tier.id").
  const planFor = (planId: PricingTier['planId']): Plan | undefined =>
    plans?.find(p => p.id === planId);

  return (
    /* Osadzone w bandzie planów (owner 2026-08-19): ta sama powierzchnia
       co karty, bez drugiej Section (unikamy podwójnego pad-block). */
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
            {FEATURE_ROWS.map(row => (
              <tr key={row.labelKey}>
                <th scope='row'>{t(row.labelKey)}</th>
                {TIERS.map(tier => (
                  <td
                    key={tier.id}
                    className={
                      isFeaturedCol(tier, showsRec(tier))
                        ? styles.highlightCol
                        : undefined
                    }>
                    <FeatureValue value={row.getValue(tier.limits, t)} t={t} />
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
                    t
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
                    t
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
                {priceNode(tier, plan, 'priceMonthly', isPending, t)}
              </div>
              <dl className={styles.compareCardList}>
                {FEATURE_ROWS.map(row => (
                  <div key={row.labelKey} className={styles.compareRow}>
                    <dt>{t(row.labelKey)}</dt>
                    <dd>
                      <FeatureValue
                        value={row.getValue(tier.limits, t)}
                        t={t}
                      />
                    </dd>
                  </div>
                ))}
                <div className={styles.compareRow}>
                  <dt>{t('table.labelPriceYearly')}</dt>
                  <dd>{priceNode(tier, plan, 'priceYearly', isPending, t)}</dd>
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
