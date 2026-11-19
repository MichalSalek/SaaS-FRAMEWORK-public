import { useQuery } from '@tanstack/react-query';
import {
  AccountTypeValue,
  SubscriptionStatusValue,
} from '@kernel/models/db_models.generated.dto';
import {
  currencyForCountry,
  isBillingCurrency,
  normalizeCountryCode,
} from '@kernel/domain/localization/country.config';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import { getBillingProfile_IO } from '../../../../../domain/account/accountIO.possibilities.api';
import { useCurrentUserAccount } from '../../../../shared/hooks/useCurrentUserAccount';
import { hasSessionToken } from '../../../../shared/hooks/currentUser.query';
import { useDetectedCountry } from '../../location/useDetectedCountry';
/** Billing history wins; new visitors receive the detected market without a picker. */
// DECISION: no standalone billing-country or currency selector; PRICING_PACKAGING section 5.4.
// A detected country suggests an address; Stripe collects the actual billing address.
export function usePricingMarket() {
  const userQuery = useCurrentUserAccount();
  const user = userQuery.data;
  const market = useDetectedCountry();
  const userPending = hasSessionToken() && userQuery.isLoading;
  const stylist =
    user?.account_type === AccountTypeValue.STYLIST &&
    user.stylist_account != null;
  const billing = useQuery({
    queryKey: [...queryKeys.account.billingProfile, user?.id ?? 'anonymous'],
    queryFn: ({ signal }) => getBillingProfile_IO(undefined, { signal }),
    enabled: stylist,
    staleTime: 60_000,
    retry: 1,
  });
  const account = user?.stylist_account;
  const storedCurrency = account?.billing?.currency?.toLowerCase();
  const status = account?.subscription_status;
  const hasSubscription =
    status != null &&
    status !== SubscriptionStatusValue.CANCELED &&
    status !== SubscriptionStatusValue.INCOMPLETE_EXPIRED;
  const isCurrencyLocked =
    hasSubscription || account?.billing?.pendingPayment != null;
  const activeCurrency =
    isCurrencyLocked && storedCurrency && isBillingCurrency(storedCurrency)
      ? storedCurrency
      : null;
  const country =
    billing.data?.country ??
    normalizeCountryCode(account?.address_country) ??
    market.data?.country_code ??
    null;
  const resolving =
    userPending ||
    (stylist && billing.isLoading) ||
    (market.isLoading &&
      (country === null || (country !== 'PL' && !isCurrencyLocked)));
  // Existing market data remains authoritative on a failed background refresh.
  // PL and a locked subscription do not depend on detected international availability.
  const isMarketError =
    market.isError === true &&
    market.data === undefined &&
    country !== 'PL' &&
    !isCurrencyLocked;
  const isCurrencyUnavailable =
    isCurrencyLocked && activeCurrency === null && !resolving;
  const currency =
    resolving || isMarketError
      ? null
      : isCurrencyLocked
        ? activeCurrency
        : currencyForCountry(country);
  const refetchMarket = async () => {
    await Promise.allSettled([
      ...(hasSessionToken() ? [userQuery.refetch()] : []),
      market.refetch(),
      ...(stylist ? [billing.refetch()] : []),
    ]);
  };
  return {
    country,
    currency,
    isCurrencyLocked,
    isCurrencyUnavailable,
    isMarketError,
    internationalBillingEnabled:
      market.data?.international_billing_enabled === true,
    isResolving: resolving,
    billingProfile: billing,
    refetchMarket,
  };
}
