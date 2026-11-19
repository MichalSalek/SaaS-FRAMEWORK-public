import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { useQueryClient } from '@tanstack/react-query';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { getBillingProfile_IO } from '../../../../domain/account/accountIO.possibilities.api';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { usePricingFunnelState } from '../../../shared/hooks/usePricingFunnelState';
import {
  clearCheckoutPortalIntent,
  readCheckoutPortalIntent,
} from '../../checkout/checkout-portal-intent';

/** Only resume the same user's explicitly started pre-purchase portal visit. */
export function useCheckoutPortalResume() {
  const router = useRouter();
  const { replace } = router;
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUserAccount();
  const { setPricingFunnel } = usePricingFunnelState();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const marker = router.query['portal'];
  const userId = user?.id;
  const intent = useMemo(
    () =>
      marker === 'back' && userId ? readCheckoutPortalIntent(userId) : null,
    [marker, userId]
  );
  useEffect(() => {
    if (!intent || !userId) {
      return;
    }
    let disposed = false;
    void (async () => {
      try {
        await queryClient.fetchQuery({
          queryKey: [...queryKeys.account.billingProfile, userId],
          queryFn: ({ signal }) => getBillingProfile_IO(undefined, { signal }),
          staleTime: 0,
        });
        if (disposed) {
          return;
        }
        setPricingFunnel({
          planId: intent.planId,
          billingPeriod: intent.billingPeriod,
          billingCountry: intent.billingCountry,
          currency: intent.currency,
          source: intent.source,
          ...(intent.promo && { promo: intent.promo }),
        });
        const path = ROUTES_FRONT.USER_ACCOUNT_PAY;
        const navigated = await replace(path);
        if (!navigated) {
          throw new Error('Navigation blocked');
        }
        clearCheckoutPortalIntent();
      } catch {
        if (!disposed) {
          setFailed(true);
        }
      }
    })();
    return () => {
      disposed = true;
    };
  }, [intent, userId, queryClient, replace, setPricingFunnel, attempt]);
  return {
    waiting: intent !== null && !failed,
    failed: intent !== null && failed,
    retry: () => {
      setFailed(false);
      setAttempt(value => value + 1);
    },
  };
}
