// UI/features/pairing/StylistClientsPage.composition.tsx
// „Twoje klientki” (/app/clients): the stylist's connected clients and the
// connection requests waiting for her. A STYLIST screen; its child is the
// client card (/app/clients/[id]).

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { useAppRole } from '../../layouts/useAppRole';
import { useNativeRouter } from '../../layouts/useNativeRouter';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import {
  StylistClientsOrganism,
  StylistClientsPendingOrganism,
} from './StylistClients.organism';

function StylistClientsPageInner() {
  const t = useTranslations('pages.pairing');
  const tButtons = useTranslations('buttons');
  useAppBarTitle(t('clientsPageTitle'));
  const { role, isRoleResolved } = useAppRole();
  const router = useNativeRouter();
  const account = useCurrentUserAccount();

  // DECISION: a client has no clients list, so this route sends her (replace) to her connections
  // screen. The decision is made only once the role is RESOLVED: before that `role` reads as
  // 'client' (DECISION in layouts/useAppRole.ts) and would send away a stylist whose session had
  // not arrived at page start. Until then the screen draws only a skeleton and sends no stylist
  // query (for a client they would end in 403). Admin stays: the code screen also treats the admin
  // as a stylist (UI_SECTION.PAIRING_ISSUE_QR).
  const isClient = isRoleResolved && role === 'client';
  useEffect(() => {
    if (isClient) {
      router.replace(ROUTES_FRONT.PAIRING);
    }
  }, [isClient, router]);

  if (!isRoleResolved && account.isError) {
    return (
      <ErrorStateMolecule
        message={t('listLoadError')}
        retryLabel={tButtons('retry')}
        onRetry={() => void account.refetch()}
        isRetrying={account.isFetching}
      />
    );
  }

  if (!isRoleResolved || isClient) {
    return <StylistClientsPendingOrganism />;
  }
  return <StylistClientsOrganism />;
}

export function StylistClientsPageComposition() {
  const t = useTranslations('pages.pairing');
  return (
    <AppLayoutComposition title={t('clientsPageTitle')}>
      <StylistClientsPageInner />
    </AppLayoutComposition>
  );
}
