import { useTrackSessionOpened } from './hooks/useTrackSessionOpened';
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

import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';
import { useState } from 'react';
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
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import { useSessionStylistName } from './hooks/useSessionStylistName';
import { useClientSessionDetail } from './hooks/useClientSessionDetail';
import { useShareSession } from './hooks/useShareSession';
import { useCloseSession } from './hooks/useCloseSession';
import { useDuplicateSession } from './hooks/useDuplicateSession';
import { SessionPhotosOrganism } from './SessionPhotos.organism';
import { ClientSessionHeroMolecule } from './ClientSessionHero.molecule';
import { SessionConclusionCardOrganism } from './components/SessionConclusionCard.organism';
import { useToggleFavorite } from '../shared/favorites/hooks/useToggleFavorite';
import { useSessionPhotoPicker } from '../shared/sessions/hooks/useSessionPhotoPicker';
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
import { SessionStylistChooserMolecule } from './components/SessionStylistChooser.molecule';

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
  const router = useRouter();
  const [confirmClose, setConfirmClose] = useState(false);

  const {
    data: session,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useClientSessionDetail(sessionId);
  useTrackSessionOpened(sessionId, session, 'client');
  const shareMutation = useShareSession(sessionId);
  const closeMutation = useCloseSession();
  const duplicateMutation = useDuplicateSession();
  const likeMutation = useToggleFavorite();
  // Same cache entry as the detail query above: taking a photo out here and
  // choosing photos in the gallery are one mechanism.
  const photoPicker = useSessionPhotoPicker(sessionId, 'session_screen');

  const stylist = useSessionStylistName(session);
  const {
    pairs,
    stylistDisplayName,
    stylistMessagePairId,
    stylistPhone,
    stylistAvatarUrl,
  } = stylist;

  useAppBarTitle(session?.name ?? stylistDisplayName ?? t('sessionTitle'));

  if (isLoading) {
    return <DetailSkeletonMolecule />;
  }

  // DECISION: a network/server failure (isError) is distinct from a genuinely missing session
  // (!session after a successful fetch). The former is transient and offers a retry; the latter is
  // terminal and routes back; conflating them hid the retry from users on flaky networks. Mirrors
  // the stylist SessionDetailPage error/not-found split. Only without a cached session: a failed
  // background refetch keeps `data` (TQ v5), and the session she is working on must not vanish
  // behind an error slab.
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
      stylistAvatarUrl={stylistAvatarUrl}
      fallbackName={hasStylist ? tLabels('stylistFallback') : t('clientLabel')}
      lifecycleState={session.lifecycleState}
      stylistMessagePairId={stylist.stylistMessagePairId}
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

  /* DECISION: a finished session (CLOSED / EXPIRED) shows the Conclusion (Peak-End) card INSTEAD
     of the photo block, the share box and the close action: it cannot be shared any more (the
     backend CAS on DRAFT/READY rejects INVALID_STATE), and the card already shows every photo
     with its like button and names the stylist in its title, so the credit row and a second
     photo grid would state the same things twice. */
  const main = isTerminal ? (
    <SessionConclusionCardOrganism
      session={{
        // DECISION: stylistName = stylistDisplayName (the stylist's name from pairs, resolved
        // above), NOT session.name, which is the container's free-text name (almost always null
        // because the modal never supplies `name`). The card renders t('conclusion.title',
        // {stylistName}) = "Twoja wizyta u {x}"; session.name gave "Twoja wizyta u " (a dangling
        // preposition) or put the session name where the stylist belongs. Falls back to
        // labels.stylistFallback when the pair cannot be resolved (the client was unpaired after
        // the session ended).
        stylistName: stylistDisplayName ?? tLabels('stylistFallback'),
        photos,
        // DECISION: "Twoja wizyta" only for a shared session that was CLOSED: closing schedules the
        // visit archive (session-container-lifecycle), while the expiry sweep and a closed draft
        // write no visit, so no claim the data lacks. (owner)
        endedAsVisit:
          session.lifecycleState ===
            SessionContainerLifecycleStateValue.CLOSED &&
          session.sharedAt !== null,
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
      onDuplicate={
        hasPhotos ? () => duplicateMutation.mutate(session.id) : undefined
      }
      isDuplicating={duplicateMutation.isPending}
    />
  ) : (
    <>
      {/* Without a stylist the chooser says so and offers the way out; a
          second box „Bez stylistki” under it would repeat the fact. */}
      {hasStylist && stylistCredit}
      {hasPhotos ? (
        <SessionPhotosOrganism
          photos={photos}
          onOpenPhoto={openPhoto}
          label={t('detailPhotosLabel')}
          countLabel={t('detailPhotosCount', { count: photos.length })}
          heroAlt={t('detailHeroPhotoAlt')}
          thumbAlt={t('inspirationAlt')}
          ownAuthorAccountId={session.stylistAccountId}
          removal={{
            label: t('detailRemovePhoto'),
            onRemove: photoPicker.toggle,
            isPending: photoPicker.isPending,
          }}
        />
      ) : hasStylist ? (
        <DetailNoPhotosMolecule
          canAdd
          isShared={isShared}
          onAddFromGallery={openStylistGallery}
          t={t}
        />
      ) : (
        <SessionStylistChooserMolecule sessionId={session.id} pairs={pairs} />
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
      <ClientSessionHeroMolecule
        session={session}
        isShared={isShared}
        isTerminal={isTerminal}
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

      {/* Photos but no stylist (she disconnected since): nothing can be shared
          until the session has a stylist again, so the chooser stands here. */}
      {!isTerminal && hasPhotos && !hasStylist && (
        <SessionStylistChooserMolecule sessionId={session.id} pairs={pairs} />
      )}
      {!isTerminal && hasPhotos && hasStylist && (
        <DetailShareSectionMolecule
          isShared={isShared}
          session={session}
          stylistPairId={stylistMessagePairId}
          stylistPhone={stylistPhone}
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
        body={t(
          session.sharedAt !== null
            ? 'closeConfirmBodyShared'
            : 'closeConfirmBodyDraft'
        )}
        t={t}
      />
    </div>
  );
}
