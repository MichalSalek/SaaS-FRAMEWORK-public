import { OutcomeStateMolecule } from '../../components/OutcomeFeedback/OutcomeState.molecule';
/* ============================================================
 * PairingPage.parts — the CLIENT's view of the Pairing screen, permanent-QR
 * only (owner).
 *
 * Model: a stylist's permanent QR leads to her public profile and the
 * connection request goes out from that profile. The screen = one action
 * (scan) + the list of connected stylists; the hero states the platform
 * limit, and when full the scan card's button opens the free-a-slot list.
 *
 * DECISION: scanning RETURNED to this screen as a PATH, not a second mechanism:
 * without it the client had only the sentence „zeskanuj aparatem telefonu”.
 * QrScannerDialog decodes the same profile URL and sends the same request as
 * the button on the profile (useRequestPair). Manual code entry is NOT here and
 * does not return: codes are no longer typeable. (owner)
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
  const feedback = useTranslations('components.outcomeFeedback');
  const [requestResult, setRequestResult] = useState<{
    name: string;
    connected: boolean;
    created: boolean;
  } | null>(null);
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
  const directStylists = pairedStylists.filter(
    person => !person.salon_origin_account_id
  );
  const isAtPairingLimit =
    directStylists.length >= PLATFORM_LIMITS.MAX_PAIRED_STYLISTS;
  // This screen's empty state is NOT a separate card (see the DECISION in
  // PairedList.parts.molecule); the scan card's content carries it.
  // `data` stays after a failed refetch/next page (TQ v5), so „do we know the
  // list" is `data !== undefined`, not `!isError`. An EMPTY cached list under
  // an error is not known either: no „0" count and no empty-state copy, only
  // the error with retry below.
  const hasList =
    data !== undefined && !(isError && pairedStylists.length === 0);
  const hasNoPairs = !isLoading && hasList && pairedStylists.length === 0;

  const handleUnpair = (accountId: string) => {
    // In-flight guard: the modal closes only in onSuccess (after the round
    // trip). A double click would fire two POSTs and two success toasts, so
    // guard here and disable the button.
    if (unpairMutation.isPending) {
      return;
    }
    unpairMutation.mutate(
      { target_account_id: accountId },
      { onSuccess: () => setIsLimitModalOpen(false) }
    );
  };

  // Hero = title + ONE line of live numbers. The platform limit is a sentence
  // here („Połączone stylistki: 2 z 3”), so no pills are needed under it. The
  // meta row is also mounted while loading (skeleton) so the hero does not
  // grow by a line when the numbers arrive.
  const heroMeta = isLoading ? (
    <SkeletonAtom variant='text' width={176} height={18} />
  ) : hasList ? (
    <span data-breakable=''>
      {t('heroMetaSlots', {
        count: directStylists.length,
        max: PLATFORM_LIMITS.MAX_PAIRED_STYLISTS,
      })}
    </span>
  ) : undefined;

  /* Scanning stands HIGH and always, not only in the empty state: a client
     connects to further stylists over the whole life of the account. When the
     limit is full a scan would be refused by the backend, so the card's only
     action becomes freeing a slot (it opens the list with disconnecting). */
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
            className='press-feedback'
            onClick={() => setIsLimitModalOpen(true)}>
            {t('freeSlotBtn')}
          </ButtonAtom>
        ) : (
          <ButtonAtom
            variant='primary'
            size='lg'
            icon={<QrCodeIcon size={20} weight='regular' />}
            className='press-feedback'
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

  // No list: the error replaces it. With a list (failed refresh): the error
  // sits under it and the list stays tappable. An empty, confirmed list
  // renders nothing: the `aside` column disappears and the scan card keeps a
  // readable measure.
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

      <OutcomeStateMolecule
        confirmed={requestResult != null}
        marked={requestResult?.created ?? false}
        message={
          requestResult
            ? feedback(
                requestResult.connected
                  ? 'pairAlreadyConnected'
                  : requestResult.created
                    ? 'pairRequestPending'
                    : 'pairAlreadyPending',
                { name: requestResult.name }
              )
            : undefined
        }
      />
      <PageColumnsMolecule
        asideSize='wide'
        main={scanCard}
        aside={listColumn}
      />

      <QrScannerDialogOrganism
        open={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onRequestResult={setRequestResult}
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
              pairedStylists={directStylists}
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
