import type { BillingCurrency } from '@kernel/domain/localization/country.config';
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
import { TIME } from '@kernel/application/constants.config';
import type { PricingPlanPrice } from '@kernel/models/pricing/pricing.dto';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import {
  PLAN_FEATURE_NAMESPACE,
  resolvePlanFeatures,
} from '../../../../../application/pricing/plan-features.catalog';
import { getPricingPlans_IO } from '../../../../../domain/pricing/pricingIO.possibilities.api';
import { usePricingMarket } from './usePricingMarket';

/* ─── Types ─── */

export interface PricingPlanCard {
  id: PricingPlan;
  name: string;
  priceMonthly: number | null;
  priceYearly: number | null;
  priceYearlyTotal?: number | null;
  icon: Icon;
  features: readonly string[];
  isCustom?: boolean;
}

/* ─── Fetch ─── */

const rawPlansQueryOptions = (currency: BillingCurrency | null) =>
  queryOptions({
    queryKey: queryKeys.pricing.plansInCurrency(currency ?? 'unresolved'),
    queryFn: async ({ signal }) => {
      if (currency === null) {
        throw new Error('Pricing currency is unresolved');
      }
      const response = await getPricingPlans_IO({ currency }, { signal });
      if (response.currency !== currency) {
        throw new Error('Pricing currency mismatch');
      }
      return response;
    },
    enabled: currency !== null,
    staleTime: 30 * TIME.MS_PER_MINUTE,
    gcTime: TIME.MS_PER_HOUR,
    /* DECISION: retry 1, not 3: the 2/4/8s backoff held isPending ~15s on every LP visit without
     * Stripe. A response with `is_fallback` is NOT thrown: it always carries the correct FREE=0 (a
     * definitional price, not from Stripe), while paid plans are null and PriceSlot shows its
     * skeleton (zero hardcoded prices, Stripe = SSOT). The silent 30s refetch keys on
     * `data.is_fallback` or a transport error, not on the error state alone. */
    retry: 1,
    retryDelay: 2000,
    refetchInterval: query =>
      query.state.status === 'error' || query.state.data?.is_fallback === true
        ? 30_000
        : false,
  });

/* ─── Hook ─── */

// DECISION: „Udostępnień/h” is NOT a plan feature and does not return to the cards. It is a
// backend abuse brake independent of the plan (DECISION at SESSION_SHARES_PER_PAIR_PER_HOUR in
// web-1/src/domain/session-container/operations/session-container-share.operation.ts). The free
// slot on the Free card holds a real ladder limit: pinned works. (owner)
export function usePricingPlans() {
  const t = useTranslations(PLAN_FEATURE_NAMESPACE);
  const market = usePricingMarket();
  const query = useQuery(rawPlansQueryOptions(market.currency));

  const plans: readonly PricingPlanCard[] | undefined = query.data
    ? (() => {
        const priceMap = new Map(
          query.data.plans.map((p: PricingPlanPrice) => [p.plan_id, p])
        );
        const metadata: readonly Omit<
          PricingPlanCard,
          'priceMonthly' | 'priceYearly' | 'priceYearlyTotal' | 'features'
        >[] = [
          {
            id: PricingPlanValue.FREE,
            name: getPlanDisplayName(PricingPlanValue.FREE),
            icon: UserIcon,
          },
          {
            id: PricingPlanValue.PRO,
            name: getPlanDisplayName(PricingPlanValue.PRO),
            icon: LightningIcon,
          },
          {
            id: PricingPlanValue.PRO_PLUS,
            name: getPlanDisplayName(PricingPlanValue.PRO_PLUS),
            icon: CrownIcon,
          },
          {
            id: PricingPlanValue.STUDIO,
            name: getPlanDisplayName(PricingPlanValue.STUDIO),
            icon: BuildingsIcon,
          },
          {
            id: PricingPlanValue.SCALE,
            name: getPlanDisplayName(PricingPlanValue.SCALE),
            icon: RocketLaunchIcon,
            isCustom: true,
          },
        ];
        return metadata.map(meta => {
          const price = priceMap.get(meta.id);
          return {
            ...meta,
            // Full enumeration (owner, no „Everything from X”): a projection of
            // the feature catalog, the same as the /pricing cards and LP previews.
            features: resolvePlanFeatures(meta.id).map(line =>
              t(line.key, line.params)
            ),
            priceMonthly: price?.monthly_price ?? null,
            priceYearly: price?.yearly_monthly_price ?? null,
            priceYearlyTotal: price?.yearly_total ?? null,
          };
        });
      })()
    : undefined;

  /* DECISION: the Stripe fallback (`is_fallback: true`, no paid prices) is NOT folded into
   * `isError`; it is the separate `pricesUnavailable` flag. AccountPayPage then renders the normal
   * plan layout degraded (price slot shows a minus, FREE=0 stays, trial and plan-change CTAs
   * disabled), so no trial CTA is live against a dead Stripe. The retry error state is ONLY a
   * real transport error (`query.isError`); the 30s refetch above leaves degraded mode by itself.
   * Static-page consumers read only `data`/`isPending`. */
  const pricesUnavailable = query.data?.is_fallback === true;

  return {
    ...query,
    ...market,
    isPending:
      market.isResolving || (market.currency !== null && query.isPending),
    isLoading:
      market.isResolving || (market.currency !== null && query.isLoading),
    isError:
      market.isMarketError || market.isCurrencyUnavailable || query.isError,
    refetch: async () => {
      if (market.isMarketError || market.currency === null) {
        await market.refetchMarket();
        return;
      }
      await query.refetch();
    },
    data: plans,
    pricesUnavailable,
  };
}
