import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useMutation } from '@tanstack/react-query';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../../application/routing/buildRoute';
import { openContact_IO } from '../../../../domain/messaging/messagingIO.possibilities.api';
import { trackFlowStep } from '../../../../application/analytics/flow-events';
import { useCurrentUser } from '../../../contexts/AuthContext.composition';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { useIsClient } from '../../../shared/hooks/useSessionRole';
import { useSwitchRole } from '../../shared/hooks/useSwitchRole';
import { clientOnboardingHref } from '../_client-onboarding.helpers';

export function withContactIntent(path: string): string {
  const url = new URL(path, 'https://local.invalid');
  url.searchParams.delete('pair');
  url.searchParams.set('contact', '1');
  return `${url.pathname}${url.search}${url.hash}`;
}

export function useProfileContactIntent(stylistId: string) {
  const router = useRouter();
  const { user, isLoading } = useCurrentUser();
  const { data: account } = useCurrentUserAccount();
  const isClient = useIsClient();
  const role = useSwitchRole();
  const [failed, setFailed] = useState(false);
  const open = useMutation({
    mutationFn: (id: string) => openContact_IO({ stylist_account_id: id }),
    onSuccess: () =>
      trackFlowStep('message', 'profile_contact_opened', {
        measurement_version: 1,
      }),
  });
  const handled = useRef<string | null>(null);
  const request = useCallback(async () => {
    setFailed(false);
    if (!stylistId || isLoading) {
      return;
    }
    const from = withContactIntent(router.asPath);
    if (!user) {
      await router.push(
        `${ROUTES_FRONT.USER_LOG}?from=${encodeURIComponent(from)}`
      );
      return;
    }
    if (account === undefined) {
      return;
    }
    if (!account.client_account) {
      await router.push(clientOnboardingHref(from));
      return;
    }
    if (account.stylist_account?.account_id === stylistId) {
      return;
    }
    if (!isClient) {
      await role.mutateAsync({ account_type: AccountTypeValue.CLIENT });
    }
    const result = await open.mutateAsync(stylistId);
    const opened = await router.push(
      `${buildRoute(ROUTES_FRONT.MESSAGES_THREAD, { pairId: result.pair_id })}?focus=1`
    );
    if (!opened) {
      throw new Error('contact_navigation_failed');
    }
  }, [stylistId, isLoading, router, user, account, isClient, role, open]);

  useEffect(() => {
    if (!router.isReady || router.query.contact !== '1') {
      handled.current = null;
      return;
    }
    if (
      isLoading ||
      !stylistId ||
      (user && account === undefined) ||
      handled.current === router.asPath
    ) {
      return;
    }
    handled.current = router.asPath;
    // Login and onboarding retain the intent. Once ready, consume it before
    // opening so refreshes and a failed request do not create a retry loop.
    if (user && account?.client_account) {
      const url = new URL(router.asPath, 'https://local.invalid');
      url.searchParams.delete('contact');
      void router.replace(
        `${url.pathname}${url.search}${url.hash}`,
        undefined,
        { shallow: true }
      );
    }
    void request().catch(() => setFailed(true));
  }, [router, isLoading, stylistId, user, account, request]);

  return {
    request: () => {
      void request().catch(() => setFailed(true));
    },
    isPending: open.isPending || role.isPending,
    failed,
  };
}
