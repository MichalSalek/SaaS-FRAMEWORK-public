import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import { previewPlanChange_IO } from '../../../../domain/account/accountIO.possibilities.api';
import { isIOError } from '../../../../application/http/io';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

export function usePlanChangePreview(
  planId: PricingPlan | null,
  billingPeriod: BillingPeriod
) {
  const query = useQuery({
    queryKey: queryKeys.account.planChangePreview({
      targetPlanId: planId ?? PricingPlanValue.FREE,
      billingPeriod,
    }),
    queryFn: ({ signal }) => {
      if (planId === null) {
        throw new Error('Brak planu do wyceny');
      }
      return previewPlanChange_IO(
        { targetPlanId: planId, billingPeriod },
        { signal }
      );
    },
    enabled: planId !== null && planId !== PricingPlanValue.FREE,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const [expiredQuote, setExpiredQuote] = useState<string | null>(null);
  const quote = query.data;
  useEffect(() => {
    if (!quote) {
      return;
    }
    const delay = Math.max(0, new Date(quote.expiresAt).getTime() - Date.now());
    const timer = setTimeout(() => setExpiredQuote(quote.quoteId), delay);
    return () => clearTimeout(timer);
  }, [quote]);
  const expired =
    quote !== undefined &&
    (expiredQuote === quote.quoteId ||
      new Date(quote.expiresAt).getTime() <= Date.now());
  const errorData = isIOError(query.error) ? query.error.httpError.data : null;
  const canceling =
    errorData != null &&
    typeof errorData === 'object' &&
    'reason' in errorData &&
    errorData.reason === 'canceling';
  return {
    ...query,
    canceling,
    expired,
    canConfirm:
      quote !== undefined && !query.isFetching && !query.isError && !expired,
  };
}
export type PlanChangePreview = ReturnType<typeof usePlanChangePreview>;
