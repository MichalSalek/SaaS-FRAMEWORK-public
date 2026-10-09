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

  // DECISION (nie usuwaj tego komentarza) — 2026-10-09: klientka nie ma listy
  // klientek, więc ta trasa odsyła ją (replace) na jej ekran połączeń. Decyzja
  // zapada DOPIERO przy rozstrzygniętej roli: `role` przed rozstrzygnięciem
  // czyta się jako 'client' (DECISION w layouts/useAppRole.ts) i odesłałaby
  // stylistkę, której sesja nie doszła przy starcie strony. Do tego czasu
  // ekran rysuje sam szkielet i nie wysyła ani jednego zapytania stylistki
  // (u klientki skończyłyby się 403). Admin zostaje: ekran kodu też traktuje
  // go jak stylistkę (UI_SECTION.PAIRING_ISSUE_QR).
  const isClient = isRoleResolved && role === 'client';
  useEffect(() => {
    if (isClient) {
      router.replace(ROUTES_FRONT.PAIRING);
    }
  }, [isClient, router]);

  // Neither the session nor the account answered: say so and offer a retry
  // instead of holding the skeleton forever.
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
