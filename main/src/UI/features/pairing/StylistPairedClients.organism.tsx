// UI/features/pairing/StylistPairedClients.organism.tsx
// The stylist's list of connected clients on „Twoje klientki” (/app/clients).
// Each row opens the client card; message and disconnect live in the row's
// „more” menu; what a client is waiting for stands on her row in words.
//
// Stack: TQ v5 + NavRow + Phosphor Icons.

import { type useTranslations } from 'next-intl';
import { QrCodeIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import type { PairedClient } from '../../../domain/pairing/pairing.types';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { IllustrationAtom } from '../../components/Illustration/Illustration.atom';
import { LP_ASSETS } from '../../assets/lpAssets';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import {
  NavRowListMolecule,
  NavRowListSkeletonMolecule,
} from '../../components/NavRow/NavRow.molecule';
import type { ClientAttention } from '../shared/pairing/clientAttention.logic';
import { StylistClientRowMolecule } from './StylistPairedClients.parts.molecule';

type TPairing = ReturnType<typeof useTranslations<'pages.pairing'>>;

export function StylistPairedClientsOrganism({
  pairedClients,
  attention,
  isLoading,
  isError,
  isRetrying,
  hasData,
  onRetry,
  moreFailed,
  onRetryMore,
  isRetryingMore,
  retryLabel,
  t,
}: {
  /** Already ordered: clients who need the stylist first. */
  pairedClients: PairedClient[];
  /** EMPTY while a source loads or fails: then no row carries a mark. */
  attention: ClientAttention;
  isLoading: boolean;
  isError: boolean;
  isRetrying: boolean;
  /** The list was fetched at least once (TQ v5 keeps it on a failed refetch). */
  hasData: boolean;
  onRetry: () => void;
  /** A later page failed: the rows shown are real but the list is incomplete. */
  moreFailed: boolean;
  onRetryMore: () => void;
  isRetryingMore: boolean;
  retryLabel: string;
  t: TPairing;
}) {
  const listError = (
    <ErrorStateMolecule
      message={t('listLoadError')}
      retryLabel={retryLabel}
      onRetry={onRetry}
      isRetrying={isRetrying}
    />
  );

  // Błąd fetchu par NIE może podszywać się pod pusty stan (stylistka z realnymi
  // połączeniami zobaczyłaby „czekasz na pierwszą klientkę"). Pełny błąd TYLKO
  // bez danych: nieudane odświeżenie w tle zostawia wczytaną listę, a błąd
  // idzie pod nią. Gdy ta lista jest PUSTA, pustki nikt nie potwierdził (TQ v5
  // trzyma pustą stronę przy nieudanym odświeżeniu), więc też pełny błąd
  // zamiast empty-state.
  if (isError && !moreFailed && (!hasData || pairedClients.length === 0)) {
    return listError;
  }

  if (isLoading) {
    return <NavRowListSkeletonMolecule leading lines={2} />;
  }

  // Pusty stan: JEDNA akcja, droga do kodu. Udostępnianie i link mieszkają na
  // ekranie kodu (owner 2026-10-09), tutaj ich nie ma.
  if (pairedClients.length === 0 && !moreFailed) {
    return (
      <EmptyStateAtom
        illustration={
          <IllustrationAtom src={LP_ASSETS.empty.emptyPairing} size='md' />
        }
        title={t('stylistClientsEmptyTitle')}
        titleAs='h2'
        description={t('stylistClientsEmptyHint')}
        action={
          <LinkButtonAtom
            href={ROUTES_FRONT.PAIRING}
            variant='outlined'
            size='md'
            icon={<QrCodeIcon size={18} weight='regular' />}>
            {t('showQrBtn')}
          </LinkButtonAtom>
        }
      />
    );
  }

  return (
    <>
      {pairedClients.length > 0 && (
        <NavRowListMolecule ariaLabel={t('clientsListLabel')}>
          {pairedClients.map(client => (
            <StylistClientRowMolecule
              key={client.user_id}
              client={client}
              attention={{
                unreadMessages: attention.unreadByPair.get(client.id) ?? 0,
                hasPendingSession: attention.pendingSessionClients.has(
                  client.user_id
                ),
                pendingSessionId:
                  attention.pendingSessionIdByClient.get(client.user_id) ?? '',
              }}
              t={t}
            />
          ))}
        </NavRowListMolecule>
      )}
      {/* usePairedList stops its eager page walk on a failed page (no retry
          loop): without this the list would silently stay cut at 50. */}
      {moreFailed && (
        <ErrorStateMolecule
          message={t('clientsLoadMoreError')}
          retryLabel={retryLabel}
          onRetry={onRetryMore}
          isRetrying={isRetryingMore}
        />
      )}
      {isError && !moreFailed && listError}
    </>
  );
}
