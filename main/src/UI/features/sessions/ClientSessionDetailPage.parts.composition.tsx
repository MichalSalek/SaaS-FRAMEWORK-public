// UI/features/sessions/ClientSessionDetailPage.parts.composition.tsx
// The client's view of one inspiration session.
//
// Layout (top → bottom on a phone):
//   1. AppHero            — session name + status, created date, expiry
//   2. Share box          — THE action of the screen (share / add photos)
//   3. Main column        — who it is for + the photos (or the finished-visit
//                           card with the same photos and like buttons)
//   4. Second column      — her note, then „Zamknij sesję” last
// From 720px of the page's own width 3 and 4 stand side by side (PageColumns).
//
// Blocks live in `.blocks.molecule.tsx` and `.actions.molecule.tsx`.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../application/routing/buildRoute';
import {
  isActiveSession,
  isTerminalSession,
} from '@kernel/domain/session-container/session-container.types';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import { StatusPillAtom } from '../../components/StatusPill/StatusPill.atom';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import { pushNewSnackbar } from '../../../application/app-snackbar/appSnackbar.possibilities.api';
import { usePairedStylists } from '../shared/pairing/hooks/usePairedStylists';
import { useClientSessionDetail } from './hooks/useClientSessionDetail';
import { useShareSession } from './hooks/useShareSession';
import { useCloseSession } from './hooks/useCloseSession';
import { SessionPhotosOrganism } from './SessionPhotos.organism';
import { SessionConclusionCardOrganism } from './components/SessionConclusionCard.organism';
import { useToggleFavorite } from '../shared/favorites/hooks/useToggleFavorite';
import {
  formatAbsoluteDate,
  formatDaysRemaining,
  getLifecycleColor,
  getLifecycleLabel,
  shouldPulseStatus,
} from './ClientSessionsPage.formatters';
import {
  DetailSkeletonMolecule,
  DetailStylistCreditMolecule,
} from './ClientSessionDetailPage.blocks.molecule';
import {
  DetailCloseActionMolecule,
  DetailCloseDialogMolecule,
  DetailNoPhotosMolecule,
  DetailShareSectionMolecule,
} from './ClientSessionDetailPage.actions.molecule';
import { ClientSessionNoteOrganism } from './ClientSessionNote.organism';
import styles from './ClientSessionDetailPage.module.css';

/* ============================================================
 * INNER COMPONENT
 * ============================================================ */

export function ClientSessionDetailPageInnerComposition({
  sessionId,
}: {
  sessionId: string;
}) {
  const t = useTranslations('pages.sessions');
  const tShare = useTranslations('pages.sessionShare');
  const tLabels = useTranslations('labels');
  const tPairing = useTranslations('pages.pairing');
  const router = useRouter();
  const lang = useCurrentLang();
  const [confirmClose, setConfirmClose] = useState(false);

  const {
    data: session,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useClientSessionDetail(sessionId);
  const {
    pairs,
    isError: pairsError,
    hasData: pairsHasData,
  } = usePairedStylists();
  const shareMutation = useShareSession(sessionId);
  const closeMutation = useCloseSession();
  const likeMutation = useToggleFavorite();

  /* Resolve stylist display name from paired list — client view's
   * SessionContainerDetailDTO carries only `stylistAccountId`.
   * DECISION (nie usuwaj tego komentarza): when the paired-stylists query
   * fails (pairsError) or the pair is gone (unpaired after the session), we
   * can't resolve the name, so the credit keeps the „stylist" label and falls
   * back to the generic `labels.stylistFallback` — the SAME fallback the
   * Conclusion card uses, so one screen never shows two different names for
   * one state. That degraded credit is NOT the same as the session genuinely
   * having no stylist (stylistAccountId null → „Bez stylistki"). Without
   * surfacing pairsError the user would silently see a generic credit and
   * assume that's correct. The effect below raises a non-blocking snackbar so
   * the failure is visible (the rest of the session renders regardless). */
  const stylistDisplayName = ((): string | null => {
    if (
      session?.stylistAccountId === null ||
      session?.stylistAccountId === undefined
    ) {
      return null;
    }
    const pair = pairs.find(
      p => p.stylistAccountId === session.stylistAccountId
    );
    if (pair?.isInactive) {
      return tPairing('inactiveAccount');
    }
    return pair?.stylistDisplayName || null;
  })();

  // Surface a pairs-fetch failure only when this session actually has a
  // stylist whose name we just failed to resolve — otherwise the toast would
  // be misleading for a stylist-less session. A failed background refetch
  // with the list still cached resolves the name fine, so it stays silent;
  // a cached list WITHOUT this stylist (e.g. empty) under a failed refetch
  // did not resolve it, so that case is surfaced too.
  const pairsUnresolved =
    pairsError &&
    (!pairsHasData ||
      !pairs.some(p => p.stylistAccountId === session?.stylistAccountId));
  useEffect(() => {
    if (pairsUnresolved && session?.stylistAccountId) {
      pushNewSnackbar(t('pairsStylistLoadError'), 'error');
    }
  }, [pairsUnresolved, session?.stylistAccountId, t]);

  useAppBarTitle(session?.name ?? stylistDisplayName ?? t('sessionTitle'));

  if (isLoading) {
    return <DetailSkeletonMolecule />;
  }

  // DECISION (nie usuwaj tego komentarza): network/server failure (isError) is
  // distinct from a genuinely missing session (!session after a successful
  // fetch). The former is transient and offers a retry; the latter is terminal
  // and routes back. Conflating them hid retry from users on flaky networks.
  // Mirrors the stylist SessionDetailPage error/not-found split.
  // Only without a cached session: a failed background refetch keeps `data`
  // (TQ v5), and the session she is working on must not vanish behind a slab.
  if (isError && !session) {
    return (
      <div className={styles.page}>
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={t('retryBtn')}
          onRetry={() => void refetch()}
          isRetrying={isFetching}
        />
      </div>
    );
  }

  if (!session) {
    return (
      <div className={styles.page}>
        <EmptyStateAtom
          size='page'
          title={t('sessionNotFound')}
          titleAs='h2'
          action={
            <ButtonAtom
              variant='outlined'
              size='md'
              onClick={() => void router.push(ROUTES_FRONT.CLIENT_SESSIONS)}>
              {t('backToSessions')}
            </ButtonAtom>
          }
        />
      </div>
    );
  }

  const photos = session.photos ?? [];
  const hasPhotos = photos.length > 0;
  const isShared = isActiveSession(session.lifecycleState);
  const isTerminal = isTerminalSession(session.lifecycleState);
  const hasStylist = session.stylistAccountId !== null;

  const handleShare = () => shareMutation.mutate();
  // The confirm dialog stays open while the close is in flight, so its
  // „Zamykanie…" label is actually seen. Success navigates to the list (hook);
  // a failure (toasted by the interceptor) leaves the dialog open for a retry.
  const handleCloseSession = () => {
    if (closeMutation.isPending) {
      return;
    }
    closeMutation.mutate(session.id, {
      onSuccess: () => setConfirmClose(false),
    });
  };
  const openPhoto = (galleryRecordId: string) => {
    void router.push(
      buildRoute(ROUTES_FRONT.PHOTO_DETAIL, { id: galleryRecordId })
    );
  };
  const openStylistGallery = () => {
    if (hasStylist) {
      void router.push(
        `${buildRoute(ROUTES_FRONT.STYLIST_GALLERY, { id: session.stylistAccountId ?? '' })}?addToSession=${session.id}`
      );
    }
  };

  const stylistCredit = (
    <DetailStylistCreditMolecule
      hasStylist={hasStylist}
      stylistDisplayName={stylistDisplayName}
      fallbackName={hasStylist ? tLabels('stylistFallback') : t('clientLabel')}
      t={t}
    />
  );

  // key: the page stays mounted across session ids; a draft must not carry
  // over to (and blur-save onto) another session.
  const note = (
    <ClientSessionNoteOrganism
      key={session.id}
      session={session}
      isTerminal={isTerminal}
      t={t}
    />
  );

  /* DECISION (nie usuwaj tego komentarza):
   * A finished session (CLOSED / EXPIRED) shows the Conclusion (Peak-End) card
   * INSTEAD of the photo block, the share box and the close action: it cannot
   * be shared any more (backend CAS on DRAFT/READY rejects INVALID_STATE), and
   * the card already shows every photo with its like button and names the
   * stylist in its title, so the credit row and a second photo grid would
   * state the same things twice. */
  const main = isTerminal ? (
    <SessionConclusionCardOrganism
      session={{
        // DECISION (nie usuwaj tego komentarza): stylistName = stylistDisplayName
        // (nazwa stylistki z pairs, rozwiązana wyżej), NIE session.name — to wolne
        // pole nazwy KONTENERA (prawie zawsze null, bo modal nigdy nie podaje `name`).
        // Card renderuje t('conclusion.title', {stylistName}) = „Twoja wizyta u {x}";
        // session.name dawało „Twoja wizyta u " (wiszący przyimek) lub wstawiało nazwę
        // sesji tam, gdzie ma być stylistka. Fallback na labels.stylistFallback gdy pary
        // nie da się rozwiązać (klientka rozparowana po zakończeniu sesji terminalnej).
        stylistName: stylistDisplayName ?? tLabels('stylistFallback'),
        photos,
      }}
      onOpenPhoto={openPhoto}
      onLikePhoto={(galleryRecordId, isFavorited, onError) => {
        likeMutation.mutate(
          {
            gallery_record_id: galleryRecordId,
            isFavorited,
          },
          { ...(onError && { onError }) }
        );
      }}
    />
  ) : (
    <>
      {stylistCredit}
      {hasPhotos ? (
        <SessionPhotosOrganism
          photos={photos}
          onOpenPhoto={openPhoto}
          label={t('detailPhotosLabel')}
          countLabel={t('detailPhotosCount', { count: photos.length })}
          heroAlt={t('detailHeroPhotoAlt')}
          thumbAlt={t('inspirationAlt')}
        />
      ) : (
        <DetailNoPhotosMolecule
          canAdd={hasStylist}
          onAddFromGallery={openStylistGallery}
          t={t}
        />
      )}
    </>
  );

  // A finished session without a note has nothing for the second column
  // (the note block renders nothing there), so the column is not opened.
  const hasSavedNote = (session.clientNote ?? '').length > 0;
  const aside = isTerminal ? (
    note
  ) : (
    <>
      {note}
      <DetailCloseActionMolecule
        onCloseSession={() => setConfirmClose(true)}
        closeIsPending={closeMutation.isPending}
        t={t}
      />
    </>
  );

  return (
    <div className={styles.page}>
      {/* The hero carries the SESSION (name, state, dates); the credit row
          carries the RECIPIENT. A named session shows its name, otherwise the
          generic „Sesja inspiracji”. The facts are ONE meta member with a gap
          between them, so no separator glyph is drawn. */}
      <AppHeroOrganism
        title={session.name ?? t('sessionTitle')}
        meta={
          <span data-breakable=''>
            <span className={styles.heroFacts}>
              <StatusPillAtom
                color={getLifecycleColor(session.lifecycleState)}
                label={getLifecycleLabel(session.lifecycleState, t)}
                pulse={shouldPulseStatus(session.lifecycleState)}
              />
              <span className={styles.heroFact}>
                {t('detailDateCreated', {
                  date: formatAbsoluteDate(session.createdAt, lang),
                })}
              </span>
              {isShared && session.expiresAt !== null && (
                <span className={styles.heroFact}>
                  {formatDaysRemaining(session.expiresAt, t)}
                </span>
              )}
            </span>
          </span>
        }
      />

      {/* Cached session + failed refresh: keep it on screen, offer a retry. */}
      {isError && (
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={t('retryBtn')}
          onRetry={() => void refetch()}
          isRetrying={isFetching}
        />
      )}

      {!isTerminal && hasPhotos && (
        <DetailShareSectionMolecule
          isShared={isShared}
          session={session}
          shareIsPending={shareMutation.isPending}
          onShare={handleShare}
          onAddFromGallery={openStylistGallery}
          t={t}
          tShare={tShare}
        />
      )}

      {isTerminal && !hasSavedNote ? (
        <PageColumnsMolecule main={main} />
      ) : (
        <PageColumnsMolecule main={main} aside={aside} />
      )}

      <DetailCloseDialogMolecule
        open={confirmClose}
        isPending={closeMutation.isPending}
        onOpenChange={setConfirmClose}
        onConfirm={handleCloseSession}
        t={t}
      />
    </div>
  );
}
