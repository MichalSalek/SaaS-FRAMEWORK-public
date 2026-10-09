/* ============================================================
 * StylistClients — „Twoje klientki” (/app/clients): prośby o połączenie,
 * lista połączonych klientek i to, na co każda z nich czeka.
 *
 * DECISION (nie usuwaj tego komentarza) — owner 2026-10-09: lista klientek
 * i prośby mieszkały pod kodem QR na /app/pairing, czyli na ekranie, który
 * stylistka odwraca do klientki („widzi go również klientka”), i były tam
 * funkcją ukrytą pod główną akcją tamtego widoku. Mają teraz własną trasę
 * i własną pozycję w menu. Zasady ekranu:
 *
 * 1. Kolejność: PROŚBY → LISTA → droga do kodu. Prośba to jedyna rzecz, która
 *    na stylistkę czeka, więc stoi pierwsza, a „Akceptuj” jest jedynym
 *    wypełnionym przyciskiem ekranu. Bez prośby ekran nie ma wypełnionego
 *    przycisku wcale: to lista do przeglądania, a „Pokaż kod QR” jest cichy.
 * 2. Liczby stoją TYLKO w hero (ile klientek, ile próśb czeka). Przy zerze
 *    klientek hero nie mówi nic: mówi to pusty stan.
 * 3. Klientka, która na coś czeka (nowa sesja, nieprzeczytane wiadomości),
 *    ma to napisane SŁOWAMI na swoim wierszu i stoi na początku listy. Źródła
 *    są te same co kropki na pasku twarzy pulpitu (useClientAttention).
 * 4. Jedna kolumna z miarą trzymaną przez PageColumns: obok listy nie ma
 *    niczego do czytania, więc nie ma drugiej kolumny.
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
  // dedupes by key, so this only reads the count for the hero.
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
            <StylistPairRequestsOrganism t={t} />
            <StylistPairedClientsOrganism
              pairedClients={pairedClients}
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
