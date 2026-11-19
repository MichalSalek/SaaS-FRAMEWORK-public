/* ============================================================
 * StylistClients — „Twoje klientki” (/app/clients): connection requests, the
 * list of connected clients and what each of them is waiting for.
 *
 * DECISION: the clients list and the requests had their own route (they were a
 * function hidden under the QR screen's main action). Rules: (1) order REQUESTS
 * -> LIST -> way to the code: a request is the only thing that waits for the
 * stylist, so "Akceptuj" is the screen's only filled button; with no request
 * there is no filled button ("Pokaż kod QR" is quiet). (2) Numbers stand ONLY in
 * the hero; at zero clients the hero says nothing, the empty state does. (3) A
 * client who waits for something has it in WORDS on her row and stands at the
 * top; sources are those of the dashboard faces strip (useClientAttention).
 * (4) One column, measure held by PageColumns. (owner)
 * ============================================================ */

import { useTranslations } from 'next-intl';
import { QrCodeIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { NavRowListSkeletonMolecule } from '../../components/NavRow/NavRow.molecule';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { isPairedClient } from '../../../domain/pairing/pairing.types';
import {
  attentionPairIds,
  orderPairsByAttention,
} from '../shared/pairing/clientAttention.logic';
import { useClientAttention } from '../shared/pairing/hooks/useClientAttention';
import { usePairedList } from '../shared/pairing/hooks/usePairedList';
import { usePendingRequests } from '../shared/pairing/hooks/usePairRequests';
import { StylistPairedClientsOrganism } from './StylistPairedClients.organism';
import { StylistPairRequestsOrganism } from './StylistPairRequests.organism';
import { PushSoftAskOrganism } from '../shared/push/PushSoftAsk.organism';
import styles from './PairingPage.module.css';

/** The hero's meta line while the numbers are on their way: the line is
 *  mounted from the start, so the hero does not grow when they arrive. */
const HERO_META_SKELETON = (
  <SkeletonAtom variant='text' width={176} height={18} />
);

/**
 * The screen before anything is known about the person (the role has not
 * resolved yet): title and the list's skeleton, and NO query of the stylist.
 */
export function StylistClientsPendingOrganism() {
  const t = useTranslations('pages.pairing');
  return (
    <div className={styles.page}>
      <AppHeroOrganism
        title={t('clientsPageTitle')}
        meta={HERO_META_SKELETON}
      />
      <PageColumnsMolecule
        main={<NavRowListSkeletonMolecule leading lines={2} />}
      />
    </div>
  );
}

export function StylistClientsOrganism() {
  const t = useTranslations('pages.pairing');
  const tButtons = useTranslations('buttons');
  const {
    pairs,
    data,
    isLoading,
    isError,
    isFetching,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  } = usePairedList();
  const attention = useClientAttention();
  // Same query (and the same 30s poll) as StylistPairRequestsOrganism: TQ
  // dedupes by key, so this reads the count for the hero and empty state.
  const pendingCount = usePendingRequests(true).data?.requests.length ?? 0;

  const allClients = pairs.filter(isPairedClient);
  // Clients who need her first; inactive accounts last (stable inside a rank,
  // so the newest connection still leads each group).
  const pairedClients = orderPairsByAttention(
    allClients,
    attentionPairIds(allClients, attention)
  );

  // An EMPTY cached list under an error is not a known list (see the list
  // organism): no number in the hero then, only the error with retry below.
  const hasList = data !== undefined && !(isError && allClients.length === 0);
  // usePairedList walks every page; until the walk ends the count is partial.
  const isCounting =
    isLoading ||
    (hasNextPage && !isFetchNextPageError && allClients.length > 0);
  const moreFailed = isFetchNextPageError && allClients.length > 0;

  // Each fact is one unbreakable piece (the hero joins them with a comma and
  // wraps BETWEEN them). Zero clients: nothing here, the empty state says it.
  let heroMeta;
  if (isCounting) {
    heroMeta = HERO_META_SKELETON;
  } else if (hasList && (allClients.length > 0 || pendingCount > 0)) {
    heroMeta = (
      <>
        {allClients.length > 0 && (
          <span>{t('heroMetaClients', { count: allClients.length })}</span>
        )}
        {pendingCount > 0 && (
          <span>{t('heroMetaRequests', { count: pendingCount })}</span>
        )}
      </>
    );
  }

  return (
    <div className={styles.page}>
      <AppHeroOrganism
        title={t('clientsPageTitle')}
        {...(heroMeta !== undefined ? { meta: heroMeta } : {})}
      />

      <PageColumnsMolecule
        main={
          <>
            {(pendingCount > 0 || allClients.length > 0) && (
              <PushSoftAskOrganism moment='stylistClients' />
            )}
            <StylistPairRequestsOrganism t={t} />
            <StylistPairedClientsOrganism
              pairedClients={pairedClients}
              hasPendingRequests={pendingCount > 0}
              attention={attention}
              isLoading={isLoading}
              isError={isError}
              isRetrying={isFetching}
              hasData={data !== undefined}
              onRetry={() => void refetch()}
              moreFailed={moreFailed}
              onRetryMore={() => void fetchNextPage()}
              isRetryingMore={isFetchingNextPage}
              retryLabel={tButtons('retry')}
              t={t}
            />
            {/* With clients on the list the screen still needs the way to add
                the next one. Quiet on purpose: the filled button belongs to a
                waiting request. The empty state carries its own copy of it. */}
            {hasList && allClients.length > 0 && (
              <div className={styles.listFooter}>
                <LinkButtonAtom
                  href={ROUTES_FRONT.PAIRING}
                  variant='outlined'
                  size='md'
                  icon={<QrCodeIcon size={18} weight='regular' />}>
                  {t('showQrBtn')}
                </LinkButtonAtom>
              </div>
            )}
          </>
        }
      />
    </div>
  );
}
