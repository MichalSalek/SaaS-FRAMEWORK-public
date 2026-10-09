import { useQuery, queryOptions } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  CrownIcon,
  UserIcon,
  LightningIcon,
  BuildingsIcon,
  RocketLaunchIcon,
  type Icon,
} from '@phosphor-icons/react';
import {
  PricingPlanValue,
  getPlanDisplayName,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';
import { TIME } from '@kernel/application/constants.config';
import type { PricingPlanPrice } from '@kernel/models/pricing/pricing.dto';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import { getPricingPlans_IO } from '../../../../../domain/pricing/pricingIO.possibilities.api';

/* ─── Types ─── */

export interface PricingPlanCard {
  id: PricingPlan;
  name: string;
  priceMonthly: number | null;
  priceYearly: number | null;
  icon: Icon;
  features: readonly string[];
  isPopular?: boolean;
  isCustom?: boolean;
}

/* ─── Static metadata (no prices — Stripe is SSOT) ─── */

const FREE_LIMITS = PRICING_POLICY.LIMITS.FREE;
const PRO_LIMITS = PRICING_POLICY.LIMITS.PRO;
const PRO_PLUS_LIMITS = PRICING_POLICY.LIMITS.PRO_PLUS;
const STUDIO_LIMITS = PRICING_POLICY.LIMITS.STUDIO;

/* ─── Fetch ─── */

const rawPlansQueryOptions = queryOptions({
  queryKey: queryKeys.pricing.plans,
  queryFn: ({ signal }) => getPricingPlans_IO(undefined, { signal }),
  staleTime: 30 * TIME.MS_PER_MINUTE,
  gcTime: TIME.MS_PER_HOUR,
  /* DECISION (S20, doprecyzowane S22): retry 1 (nie 3) — backoff 2/4/8s
   * trzymał isPending ~14,6s na każdej wizycie LP bez Stripe. S22: response
   * z `is_fallback` NIE jest już wyrzucany throwem — fallback niesie zawsze
   * poprawne FREE=0 (cena definicyjna, hardcodowana po stronie backendu,
   * nie-Stripe'owa), a throw kasował też ją, przez co karta Free kręciła
   * skeleton-roll w nieskończoność. Płatne plany w fallbacku mają null →
   * PriceSlot pokazuje skeleton-roll (patrz pricing.policy.ts ~236, zero cen
   * hardcoded — Stripe = SSOT). Cicha dociążka co 30s zostaje: kluczem jest
   * `data.is_fallback` (oraz error transportowy), nie sam error-state. */
  retry: 1,
  retryDelay: 2000,
  refetchInterval: query =>
    query.state.status === 'error' || query.state.data?.is_fallback === true
      ? 30_000
      : false,
});

/* ─── Hook ─── */

// DECISION (nie usuwaj tego komentarza) — owner 2026-10-09: „Udostępnień/h”
// NIE jest cechą planu i nie wraca na karty. To był limit skrzynki stylistki
// liczony ze wszystkich jej klientek, niezrozumiały w cenniku i karzący
// niewinne klientki; został hamulcem przeciw nadużyciom po stronie backendu,
// stałą platformy niezależną od planu (DECISION przy
// SESSION_SHARES_PER_PAIR_PER_HOUR w web-1). Wolne miejsce na karcie Free
// zajmuje prawdziwy limit z drabinki: liczba przypiętych wzorów.
export function usePricingPlans() {
  const t = useTranslations('account.plan');
  const query = useQuery(rawPlansQueryOptions);

  const plans: readonly PricingPlanCard[] | undefined = query.data
    ? (() => {
        const priceMap = new Map(
          query.data.plans.map((p: PricingPlanPrice) => [p.plan_id, p])
        );
        const metadata: readonly Omit<
          PricingPlanCard,
          'priceMonthly' | 'priceYearly'
        >[] = [
          {
            id: PricingPlanValue.FREE,
            name: getPlanDisplayName(PricingPlanValue.FREE),
            icon: UserIcon,
            features: [
              t('featurePhotos', { count: FREE_LIMITS.max_gallery_records }),
              t('featurePairedClients', {
                count: FREE_LIMITS.max_paired_clients,
              }),
              t('featurePinnedPro', {
                count: FREE_LIMITS.max_pinned_records,
              }),
              t('featurePublicProfile'),
            ],
          },
          {
            id: PricingPlanValue.PRO,
            name: getPlanDisplayName(PricingPlanValue.PRO),
            icon: LightningIcon,
            features: [
              t('featureUnlimitedGallery'),
              t('featureUnlimitedClients'),
              t('featureNoWatermark'),
              t('featureHistoryDays', {
                count: PRO_LIMITS.history_retention_days,
              }),
              t('featurePinnedPro', { count: PRO_LIMITS.max_pinned_records }),
            ],
          },
          {
            id: PricingPlanValue.PRO_PLUS,
            name: getPlanDisplayName(PricingPlanValue.PRO_PLUS),
            icon: CrownIcon,
            features: [
              t('featureUnlimitedGallery'),
              t('featureUnlimitedClients'),
              // Parytet z LP /pricing Pro Marka (review S81): znak wodny jawny —
              // in-app upgrade-card nie może gubić benefitu, który LP obiecuje.
              t('featureNoWatermark'),
              // Pro Marka = pełna historia (history_retention_days=-1 sentinel
              // „na zawsze"): featureFullHistory jak STUDIO, NIE featureHistoryDays
              // (renderowało literalnie „(-1 dni)" — S53 /spar). Priorytetowe
              // wsparcie należy do Scale (featureSla/featureDedicatedEngineer),
              // nie do Pro Marka — zastąpione namesake feature: kolor marki.
              t('featureFullHistory'),
              t('featureBrandColor'),
              t('featurePinnedPro', {
                count: PRO_PLUS_LIMITS.max_pinned_records,
              }),
            ],
          },
          {
            id: PricingPlanValue.STUDIO,
            name: getPlanDisplayName(PricingPlanValue.STUDIO),
            icon: BuildingsIcon,
            // DECISION (nie usuwaj tego komentarza):
            // isPopular na STUDIO = ROZDZIELONA semantyka (owner 2026-07-14, opcja 3):
            // Studio niesie „Najpopularniejszy/Most popular" (in-app badge account.pay.popularBadge
            // + onboarding planPopularBadge), a PRO niesie „Polecany/Recommended" (LP
            // PricingPageData.isRecommended). Dwa różne badge o różnych rolach współistnieją
            // celowo — NIE przenosić isPopular na PRO ani nie ujednolicać etykiet.
            isPopular: true,
            // Pełna enumeracja (owner S81): bez „Wszystko z Pro Marka" —
            // dziedziczone cechy wypisane jawnie (znak wodny, kolor marki).
            features: [
              t('featureUnlimitedPhotos'),
              t('featureUnlimitedClientsStudio'),
              t('featureNoWatermark'),
              t('featureBrandColor'),
              t('featurePinnedPro', {
                count: STUDIO_LIMITS.max_pinned_records,
              }),
              t('featureSalonTeam'),
              t('featureFullHistory'),
            ],
          },
          {
            id: PricingPlanValue.SCALE,
            name: getPlanDisplayName(PricingPlanValue.SCALE),
            icon: RocketLaunchIcon,
            isCustom: true,
            // Pełna enumeracja (owner S81 + review): bez „Wszystko ze Studio" —
            // WSZYSTKIE cechy dziedziczone ze Studio (znak wodny, kolor marki)
            // + enterprise jawnie, żeby top-tier nie wyglądał na uboższy niż Studio.
            features: [
              t('featureUnlimitedPhotos'),
              t('featureUnlimitedClientsStudio'),
              t('featureNoWatermark'),
              t('featureBrandColor'),
              t('featureFullHistory'),
              t('featureUnlimitedTeam'),
              t('featureCustomIntegrations'),
              t('featureSla'),
              t('featureDedicatedEngineer'),
            ],
          },
        ];
        return metadata.map(meta => {
          const price = priceMap.get(meta.id);
          return {
            ...meta,
            priceMonthly: price?.monthly_price ?? null,
            priceYearly: price?.yearly_monthly_price ?? null,
          };
        });
      })()
    : undefined;

  /* DECISION (S26, zastępuje S22 — nie usuwaj): fallback Stripe
   * (`is_fallback:true` = brak cen płatnych planów) NIE jest już zlewany
   * w `isError` — to osobna flaga `pricesUnavailable`. AccountPayPage
   * renderuje wtedy NORMALNY układ planów w trybie degraded: slot ceny =
   * znak minus (FREE=0 zawsze poprawne, definicyjne), CTA trialu i
   * upgrade/downgrade disabled — pierwotny problem S22 (aktywny trial CTA
   * przy martwym Stripe) zostaje rozwiązany na poziomie CTA, nie przez
   * full-screen error. Error-state z retry = WYŁĄCZNIE realny błąd
   * transportowy (`query.isError`). Cicha dociążka co 30s (refetchInterval
   * wyżej) sama wyprowadza ekran z degraded po powrocie Stripe. Konsumenci
   * stron statycznych czytają tylko `data`/`isPending` — bez zmian. */
  const pricesUnavailable = query.data?.is_fallback === true;

  return { ...query, data: plans, pricesUnavailable };
}
