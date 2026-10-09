/* ============================================================
 * PairingPage.parts — widok KLIENTKI na ekranie Parowanie,
 * wersja STAŁY-ONLY (decyzja ownera 2026-07-12).
 *
 * Model parowania: stały QR stylistki prowadzi na jej publiczny profil, a
 * prośba o połączenie wychodzi z tego profilu. Ekran = jedna akcja (skan) +
 * lista połączonych stylistek; limit platformowy mówi hero, a zwalnianie
 * miejsca przy komplecie otwiera przycisk karty skanu (S126).
 *
 * DECISION (nie usuwaj tego komentarza) — owner 2026-07-12, uzupełnione
 * 2026-09-09: skanowanie WRÓCIŁO na ten ekran, ale jako DROGA, nie jako drugi
 * mechanizm. Wersja z 2026-07-12 zdjęła Scan/Manual razem z flow generowanych
 * kodów i zostawiła klientce samo zdanie „zeskanuj aparatem telefonu" —
 * zgłoszenie ownera: „nie wiem, jak się mam połączyć… każda aplikacja ma swoje
 * skanowanie". `QrScannerDialog` dekoduje ten sam URL profilu i wysyła tę samą
 * prośbę co przycisk na profilu (useRequestPair). Ręcznego wpisywania kodu
 * nadal NIE ma i nie wraca — kody nie są już wpisywalne.
 * ============================================================ */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { QrCodeIcon } from '@phosphor-icons/react';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { NavRowListSkeletonMolecule } from '../../components/NavRow/NavRow.molecule';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { AppDialogAtom } from '../../primitives/AppDialog.atom';
import { usePairedList } from '../shared/pairing/hooks/usePairedList';
import { useUnpair } from '../shared/pairing/hooks/useUnpair';
import { InfiniteScrollTriggerComposition } from '../../components/InfiniteScrollTrigger.composition';
import { PLATFORM_LIMITS } from '@kernel/policies/pricing.policy';
import { isPairedStylist } from '../../../domain/pairing/pairing.types';
import { QrScannerDialogOrganism } from './QrScannerDialog.organism';
import {
  PairedStylistsSectionMolecule,
  LimitModalBodyMolecule,
} from './PairedList.parts.molecule';
import styles from './PairingPage.module.css';

export function ClientPairingOrganism() {
  const t = useTranslations('pages.pairing');
  const tButtons = useTranslations('buttons');
  const [isLimitModalOpen, setIsLimitModalOpen] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
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
  const unpairMutation = useUnpair();

  const pairedStylists = pairs.filter(isPairedStylist);
  const isAtPairingLimit =
    pairedStylists.length >= PLATFORM_LIMITS.MAX_PAIRED_STYLISTS;
  // Pusty stan tego ekranu NIE jest osobną kartą (patrz DECISION w
  // PairedList.parts.molecule) — niesie go treść karty skanu.
  // `data` stays after a failed refetch/next page (TQ v5), so „do we know the
  // list" is `data !== undefined`, not `!isError`. An EMPTY cached list under
  // an error is not known either: no „0" count and no empty-state copy, only
  // the error with retry below.
  const hasList =
    data !== undefined && !(isError && pairedStylists.length === 0);
  const hasNoPairs = !isLoading && hasList && pairedStylists.length === 0;

  const handleUnpair = (accountId: string) => {
    // In-flight guard: modal zamyka się dopiero w onSuccess (po round-tripie).
    // Revoke is now idempotent on already-revoked, but a double-click still
    // fires two POSTs and two success toasts. Guard + disabled on the button.
    if (unpairMutation.isPending) {
      return;
    }
    unpairMutation.mutate(
      { target_account_id: accountId },
      { onSuccess: () => setIsLimitModalOpen(false) }
    );
  };

  // Hero = tytuł + JEDNA linia żywych liczb. Limit platformowy stoi tu zdaniem
  // („Połączone stylistki: 2 z 3”), więc nie potrzebuje pigułek pod spodem.
  // Wiersz meta jest zamontowany także w trakcie ładowania (skeleton), żeby
  // hero nie rósł o linię, gdy liczby dojdą.
  const heroMeta = isLoading ? (
    <SkeletonAtom variant='text' width={176} height={18} />
  ) : hasList ? (
    <span data-breakable=''>
      {t('heroMetaSlots', {
        count: pairedStylists.length,
        max: PLATFORM_LIMITS.MAX_PAIRED_STYLISTS,
      })}
    </span>
  ) : undefined;

  /* Skanowanie stoi WYSOKO i zawsze, nie tylko w pustym stanie: klientka łączy
     się z kolejnymi stylistkami przez całe życie konta. Przy komplecie skan
     kończyłby się odmową backendu, więc jedyną akcją karty staje się
     zwolnienie miejsca (otwiera listę z rozłączaniem). */
  const scanCard = (
    <div className={styles.scanFrame}>
      <section className={styles.scanCard}>
        <p className={styles.scanBody}>
          {isAtPairingLimit
            ? t('scanCtaLimit')
            : hasNoPairs
              ? t('scanCtaBodyEmpty')
              : t('scanCtaBody')}
        </p>
        {isAtPairingLimit ? (
          <ButtonAtom
            variant='outlined'
            size='lg'
            className='haptic-press'
            onClick={() => setIsLimitModalOpen(true)}>
            {t('freeSlotBtn')}
          </ButtonAtom>
        ) : (
          <ButtonAtom
            variant='primary'
            size='lg'
            icon={<QrCodeIcon size={20} weight='regular' />}
            className='haptic-press'
            onClick={() => setIsScannerOpen(true)}>
            {t('scanCtaButton')}
          </ButtonAtom>
        )}
      </section>
    </div>
  );

  const listError = (
    <ErrorStateMolecule
      message={t('listLoadError')}
      retryLabel={tButtons('retry')}
      onRetry={() => void refetch()}
      isRetrying={isFetching}
    />
  );

  // Bez listy: błąd zamiast niej. Z listą (nieudane odświeżenie): błąd pod
  // nią, lista zostaje klikalna. Pusta, potwierdzona lista nie renderuje nic:
  // wtedy kolumna `aside` znika, a karta skanu trzyma czytelną miarę.
  const hasRows = hasList && pairedStylists.length > 0;
  const listColumn =
    isLoading || hasRows || isError ? (
      <>
        {isLoading && (
          <section className={styles.listSection}>
            <h2 className={styles.sectionTitle}>{t('stylistsSectionTitle')}</h2>
            <NavRowListSkeletonMolecule leading lines={2} />
          </section>
        )}
        {hasRows && (
          <PairedStylistsSectionMolecule
            pairedStylists={pairedStylists}
            t={t}
          />
        )}
        {isError && !isLoading && listError}
        <InfiniteScrollTriggerComposition
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onFetchNextPage={fetchNextPage}
          isFetchNextPageError={isFetchNextPageError}
        />
      </>
    ) : null;

  return (
    <div className={styles.page}>
      <AppHeroOrganism title={t('heroTitleClient')} meta={heroMeta} />

      <PageColumnsMolecule
        asideSize='wide'
        main={scanCard}
        aside={listColumn}
      />

      <QrScannerDialogOrganism
        open={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
      />

      {/* Pairing Limit Modal */}
      <AppDialogAtom
        open={isLimitModalOpen}
        disablePointerDismissal={unpairMutation.isPending}
        onOpenChange={open => {
          if (!open && !unpairMutation.isPending) {
            setIsLimitModalOpen(false);
          }
        }}>
        <AppDialogAtom.Content
          title={t('limitModalTitle')}
          closeDisabled={unpairMutation.isPending}>
          <AppDialogAtom.Body>
            <LimitModalBodyMolecule
              pairedStylists={pairedStylists}
              onUnpair={handleUnpair}
              isUnpairPending={unpairMutation.isPending}
              unpairingAccountId={
                unpairMutation.isPending
                  ? (unpairMutation.variables.target_account_id ?? null)
                  : null
              }
              t={t}
            />
          </AppDialogAtom.Body>
        </AppDialogAtom.Content>
      </AppDialogAtom>
    </div>
  );
}
