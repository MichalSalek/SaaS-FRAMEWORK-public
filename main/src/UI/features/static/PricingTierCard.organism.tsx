// UI/features/static/PricingTierCard.organism.tsx
//
// Pojedyncza karta planu cennika LP — wyciągnięta z PricingTierSection
// (max-lines + układ 2+2, głos ownera 2026-07-11: karta renderuje się w DWÓCH
// gridach — jasna para Free+Pro i atramentowy band premium Pro Marka+Studio —
// więc JSX karty musi żyć raz). Cała logika sekcyjna (split par, kotwice,
// funnel hrefy) zostaje w organiźmie; karta dostaje gotowe wartości.

import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { useLocale, useTranslations } from 'next-intl';
import { trackPricingPlanClicked } from '../../../application/analytics/cta-events';
import { PushPinIcon } from '@phosphor-icons/react';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { EyebrowAtom } from '../../components/Eyebrow/Eyebrow.atom';
import { PriceSlotAtom } from '../../components/PriceSlot/PriceSlot.atom';
import { AlignedPricingFeatureListMolecule } from '../shared/pricing/AlignedPricingFeatureList.molecule';
import { groszToPln } from '../shared/pricing/pricingFormat';
import { PlanTrialFramingMolecule } from '../shared/pricing/PlanTrialFraming.molecule';
import type { PricingTier } from './PricingPageData';
import type { TierFeatureResult } from './PricingPageData';
import styles from './PricingPage.module.css';

// "Za grosze dziennie" micro-price divisor: ceny przychodzą w groszach, więc
// /100 daje PLN, a /30 sprowadza miesięczną cenę do dziennej (100 * 30 = 3000).
const GROSZE_TO_PLN_PER_DAY_DIVISOR = 100 * 30;

export interface PricingTierCardProps {
  tier: PricingTier;
  featureResults: TierFeatureResult[];
  /** Wspólna liczba wierszy feature W PARZE (tor subgrid — spacery). */
  maxFeatureRows: number;
  /** Cena bieżącego okresu (grosze) — null gdy Stripe fallback. */
  price: number | null;
  monthlyPrice: number | null;
  yearlyPrice: number | null;
  isYearly: boolean;
  isPending: boolean;
  currentPlan: PricingPlan | null;
  billingPeriod: BillingPeriod;
  /** Decoy-anchor Studio↔Pro+ (grosze) — tylko karta target. */
  anchoringDiff: number | null;
  ctaHref: string;
  onCtaFunnel: () => void;
}

/**
 * Karta = subgrid per-element (głos ownera S42): KAŻDY wiersz (badge / nazwa /
 * tagline / oferta / cena-po / micro / pinned / features / nota / CTA /
 * stopka) dzieli wspólny tor między planami W SWOIM gridzie → linie poziome
 * wyrównane mimo różnej długości treści. Puste sloty renderują spację.
 */
export function PricingTierCardOrganism({
  tier,
  featureResults,
  maxFeatureRows,
  price,
  monthlyPrice,
  yearlyPrice,
  isYearly,
  isPending,
  currentPlan,
  billingPeriod,
  anchoringDiff,
  ctaHref,
  onCtaFunnel,
}: PricingTierCardProps) {
  const t = useTranslations('static.pricing');
  const locale = useLocale();

  // Yearly-saving (głos ownera, restore S44): kwota oszczędności roczna vs
  // miesięczna (grosze → PLN: *12/100). Omnibus referencePrice bierze
  // monthlyPrice jako cenę referencyjną (bazuje na monthly, niezależna od
  // launch-offer — stripe.config §Omnibus). Oba tylko na paid+yearly.
  const yearlySaving =
    monthlyPrice !== null && yearlyPrice !== null
      ? Math.round(((monthlyPrice - yearlyPrice) * 12) / 100)
      : null;
  // DECISION (nie usuwaj tego komentarza):
  // Rekomendacja czyta `tier.isRecommended`, a NIE `tier.id === 'pro'`. Twardy
  // identyfikator byl drugim zrodlem prawdy obok `PricingPageData`, z ktorego
  // korzysta juz siostrzana `PricingComparisonTable` — przeniesienie polecenia
  // na inny plan zmienialoby tabele, a negatyw zostawalby na Pro.
  const isRecommended = tier.isRecommended === true;
  const isCurrent = currentPlan === tier.planId;
  // Wybranie planu WYGRYWA nad rekomendacja: stylistce, ktora juz jest na tym
  // planie, nie reklamujemy go jako „polecany" (parytet z onboardingiem
  // `isRec && !isSel` i ze strona platnosci `isPopular && !isCurrent`).
  // Band premium to decyzja KOMPOZYCJI sekcji, nie rekomendacja, wiec zostaje
  // na atramencie niezaleznie od tego, ktory plan ma uzytkowniczka.
  const showsRecommendation = isRecommended && !isCurrent;
  const isFree = tier.planId === PricingPlanValue.FREE;

  return (
    <article
      className={styles.tierCard}
      data-target={tier.isTarget || undefined}
      data-pro={showsRecommendation || undefined}
      data-onink={tier.isPremiumBand || undefined}
      /* Głos S98/B: „polecany" mówi JEDNYM językiem — pełnym negatywem.
         data-negative zbiera KAŻDĄ kartę na atramencie (Pro z jasnej pary
         + obie karty bandu premium), żeby nadpisania kolorów treści miały
         jeden selektor zamiast dwóch rozjeżdżających się list. */
      data-negative={showsRecommendation || tier.isPremiumBand || undefined}
      data-scroll-reveal>
      <div className={styles.tierKickerRow}>
        {showsRecommendation && (
          <EyebrowAtom as='p' variant='plain' className={styles.tierKickerPro}>
            {t('tierSection.recommendedNote')}
          </EyebrowAtom>
        )}
        {tier.badgeKey && (
          <EyebrowAtom as='p' variant='plain' className={styles.tierBadge}>
            {t(tier.badgeKey)}
          </EyebrowAtom>
        )}
      </div>
      {/* Nazwa planu = <h3> pod H2 sekcji „Plany i ceny" (hierarchia nagłówków
          + waga nagłówkowa dla fraz „Pro Marka"/„Studio"). Wcześniej h2 dawał
          4 równorzędne h2 w sekcji, spłaszczając strukturę. */}
      <h3 className={styles.tierName}>{t(tier.nameKey)}</h3>
      <p className={styles.tierTagline}>{t(tier.taglineKey)}</p>
      {/* Trial-framing (współdzielona molekuła — parytet z mini-cennikami LP
          gwarantowany strukturalnie): OFERTA wejścia bohaterem tam, gdzie
          zwykle stoi cena; kwota schowana małym drukiem pod spodem. */}
      <PlanTrialFramingMolecule
        ledeText={
          isFree ? t('tierSection.freeLede') : t('tierSection.trialLede')
        }
        renderAfter={
          !isFree && price !== null && price > 0
            ? amount =>
                t.rich(
                  isYearly
                    ? 'tierSection.trialPriceAfterYearly'
                    : 'tierSection.trialPriceAfter',
                  { price: groszToPln(price), amount }
                )
            : null
        }
        ledeClassName={styles.tierTrialLede}
        afterClassName={styles.tierTrialAfter}
      />
      {/* Yearly-meta (restore S44): oszczędność roczna + Omnibus cena
          referencyjna. Wrapper ZAWSZE renderowany (stały child-count = subgrid
          trzyma wiersze); pusty na monthly/Free → tor auto-collapse. */}
      <div className={styles.tierYearlyMeta}>
        {isYearly && !isFree && yearlySaving !== null && yearlySaving > 0 && (
          <p className={styles.tierSaving}>
            {t('tierSection.savingText', { saving: yearlySaving })}
          </p>
        )}
        {isYearly && !isFree && monthlyPrice !== null && monthlyPrice > 0 && (
          <p className={styles.tierReferencePrice}>
            {t.rich('tierSection.referencePrice', {
              price: () => (
                <PriceSlotAtom
                  value={monthlyPrice}
                  isLoading={isPending}
                  size='sm'
                />
              ),
            })}
          </p>
        )}
      </div>
      <p className={styles.tierMicroPrice}>
        {/* Micro-kotwica „za grosze dziennie" TYLKO na monthly (fresh-eyes
            2026-07-11 MAJOR 3): yearly niesie już oszczędność + cenę
            referencyjną Omnibus — czwarta liczba rozmywała kotwicę. */}
        {!isFree && !isYearly && price !== null && price > 0
          ? t('tierSection.microPrice', {
              /* Locale-aware separator dziesiętny (PL/DE „2,0", EN "2.0"). */
              value: new Intl.NumberFormat(locale, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              }).format(price / GROSZE_TO_PLN_PER_DAY_DIVISOR),
            })
          : ' '}
      </p>
      {/* Jedyne miejsce liczby przypiętych wzorów (census S22 z. 3). */}
      <p className={styles.tierPinnedInfo}>
        <PushPinIcon size={14} weight='regular' />
        <span>
          {t('tierSection.pinnedInfo', { count: tier.limits.pinned })}
        </span>
      </p>
      {/* Aesop restraint: features jako hairline-WIERSZE (typografia + linia,
          bez ikon). Funkcjonalne checkmarki w tabeli. */}
      <AlignedPricingFeatureListMolecule
        className={styles.tierFeatureRows}
        rowCount={maxFeatureRows}
        items={featureResults.map(fr => ({
          id: fr.key,
          content: t(fr.key, fr.params),
        }))}
      />
      {/* Nota body (głos ownera S42 + restore S44): Studio niesie DYNAMICZNY
          decoy-anchor „tylko X PLN więcej niż Pro+"; Pro+ statyczny decoy-note;
          reszta ' '. Fallback: brak cen ze Stripe → statyczny studioBodyNote. */}
      <p className={styles.tierBodyNote}>
        {tier.isTarget && anchoringDiff !== null && anchoringDiff > 0
          ? t.rich('tierSection.anchoringNote', {
              diff: () => (
                <PriceSlotAtom
                  value={anchoringDiff}
                  isLoading={isPending}
                  size='sm'
                />
              ),
            })
          : tier.bodyNoteKey
            ? t(tier.bodyNoteKey)
            : ' '}
      </p>
      {/* Plan-aware CTA (primary): current plan → disabled marker; inne →
          deep-link login→/pay z funnel-intentem na KAŻDYM viewporcie (S43
          usunął gate get-app na desktopie — DECISION w organiźmie sekcji). */}
      {isCurrent ? (
        <span className={styles.tierCtaSlot}>
          <ButtonAtom
            variant='outlined'
            size='lg'
            className={styles.tierCtaButton}
            disabled>
            {t('tierSection.currentPlanCta')}
          </ButtonAtom>
        </span>
      ) : (
        <span className={styles.tierCtaSlot}>
          {/* Jeden element interaktywny (LinkButtonAtom = <a> jak przycisk);
              <Link><ButtonAtom/></Link> było <a><button> — nieprawidłowe
              zagnieżdżenie i podwójny tab-stop. */}
          {/* Hierarchia CTA: Free = outlined (cichszy — free-forever nie
              konkuruje z trialem), każdy plan płatny = gold solid.
              Pro miał tu CTA w ATRAMENCIE, bo jego karta była JASNA. Po głosie
              S98/B karta Pro sama jest negatywem, więc atramentowy przycisk na
              atramentowej karcie dawał ~1.05:1 i po prostu znikał (zmierzone
              DOM-probem: przycisk rgb(17,17,17) na karcie rgb(28,28,32)).
              Gold jest tu regułą R6 w czystej postaci: kontrast zostaje dla
              akcji — dokładnie tak, jak na kartach bandu premium. */}
          <LinkButtonAtom
            href={ctaHref}
            variant={isFree ? 'outlined' : 'primary'}
            size='lg'
            className={styles.tierCtaButton}
            onClick={() => {
              // Semantyczny event funnela OBOK nawigacji. Przez cta-events, więc
              // trafia i do PostHoga, i do GA4 (`select_item`) — wcześniej wybór
              // planu był widoczny wyłącznie w PostHogu.
              trackPricingPlanClicked(tier.planId, billingPeriod);
              onCtaFunnel();
            }}>
            {currentPlan !== null
              ? t('tierSection.switchPlanCta')
              : t(tier.ctaKey)}
          </LinkButtonAtom>
        </span>
      )}
      {/* Stopka odchudzona (głos ownera S42). Jedna linia trust. */}
      <p className={styles.tierFooterNote}>
        {isFree
          ? t('tierSection.footerNoteFree')
          : t('tierSection.footerNotePaid')}
      </p>
    </article>
  );
}
