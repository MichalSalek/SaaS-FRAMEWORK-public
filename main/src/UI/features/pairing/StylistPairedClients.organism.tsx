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
  hasPendingRequests,
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
  /** A waiting request already gives the stylist a next action. */
  hasPendingRequests: boolean;
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

  // A pairs fetch error must NOT pose as the empty state (a stylist with real
  // connections would read „waiting for your first client”). Full error ONLY
  // without data: a failed background refresh keeps the loaded list and the
  // error goes under it. An EMPTY list under an error is not confirmed either
  // (TQ v5 keeps the empty page on a failed refresh), so also a full error.
  if (isError && !moreFailed && (!hasData || pairedClients.length === 0)) {
    return listError;
  }

  if (isLoading) {
    return <NavRowListSkeletonMolecule leading lines={2} />;
  }

  // Empty state: ONE action, the way to the code. Sharing and the link live on
  // the code screen (owner), not here.
  if (pairedClients.length === 0 && !moreFailed) {
    if (hasPendingRequests) {
      return null;
    }
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
