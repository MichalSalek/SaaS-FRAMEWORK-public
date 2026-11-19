import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import { authClient } from '../../../../application/auth/better-auth-client';
import { AppLayoutComposition } from '../../../layouts/AppLayout.composition';
import { SkeletonAtom } from '../../../components/Skeleton/Skeleton.atom';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { usePricingFunnelState } from '../../../shared/hooks/usePricingFunnelState';
import { hasResolvedStylistPlan } from '../../../shared/onboarding-plan.helpers';
import { readPrefilledRole, roleHintFromAccounts } from '../onboarding.helpers';

/**
 * DECISION: registration links can be opened by an existing customer. Resume the
 * resolved role instead of offering a second onboarding and a forbidden Free
 * checkout. Latch admission before account creation so a new flow keeps its success
 * screen when its own account query refreshes. Test: OnboardingEntryGate.test.tsx.
 */
export function OnboardingEntryGateMolecule({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const t = useTranslations('pages.onboarding');
  const c = useTranslations('account.checkout');
  const account = useCurrentUserAccount();
  const { isPending: sessionPending } = authClient.useSession();
  const { getPricingFunnel } = usePricingFunnelState();
  const [admitted, setAdmitted] = useState(false);

  useEffect(() => {
    if (
      admitted ||
      !router.isReady ||
      sessionPending ||
      account.isLoading ||
      account.isFetching ||
      account.data === undefined
    ) {
      return;
    }
    const user = account.data;
    const funnel = getPricingFunnel();
    const role =
      readPrefilledRole(router.query) ??
      (funnel !== null ? 'stylist' : roleHintFromAccounts(user));
    if (role === 'stylist' && hasResolvedStylistPlan(user)) {
      const target =
        funnel !== null || user.account_type !== AccountTypeValue.STYLIST
          ? ROUTES_FRONT.USER_ACCOUNT_PAY
          : ROUTES_FRONT.APP;
      void router.replace(target);
      return;
    }
    if (
      role === 'client' &&
      user.client_account !== null &&
      user.account_type === AccountTypeValue.CLIENT
    ) {
      void router.replace(ROUTES_FRONT.APP);
      return;
    }
    setAdmitted(true);
  }, [
    admitted,
    router,
    sessionPending,
    account.data,
    account.isLoading,
    account.isFetching,
    getPricingFunnel,
  ]);

  if (admitted) {
    return children;
  }
  return (
    <AppLayoutComposition
      title={t('processTitle')}
      hideBottomNav
      hideBackButton>
      {account.isError ? (
        <ErrorStateMolecule
          message={c('accountLoadError')}
          retryLabel={c('retry')}
          onRetry={() => void account.refetch()}
          isRetrying={account.isFetching}
        />
      ) : (
        <SkeletonAtom variant='text' width='70%' height={32} />
      )}
    </AppLayoutComposition>
  );
}
