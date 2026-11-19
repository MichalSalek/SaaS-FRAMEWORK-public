import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { getPricingMarket_IO } from '../../../../domain/pricing/pricingIO.possibilities.api';

/** IP country is a default suggestion; callers must preserve saved or manually edited values. */
export function useDetectedCountry() {
  return useQuery({
    queryKey: queryKeys.pricing.market,
    queryFn: ({ signal }) => getPricingMarket_IO(undefined, { signal }),
    staleTime: 10 * 60_000,
    retry: 1,
  });
}
