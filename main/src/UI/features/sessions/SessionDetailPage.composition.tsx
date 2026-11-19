// UI/features/sessions/SessionDetailPage.composition.tsx
// Stylist view of a session shared by a client.
// Route: /app/inbox/session/[sessionId]
//
// Layout (top → bottom on a phone):
//   1. AppHero         — session name + status, when received, when it expires
//   2. Main column     — who sent it (her card, the conversation), her
//                        message, her photos
//   3. Second column   — one-time tip, her message, the stylist's private
//                        note, earlier sessions with this client
// From 720px of the page's own width 2 and 3 stand side by side (PageColumns).
// The screen has no filled button: it is read first, and its only input is
// the private note. Closing the session after the visit is the last thing on
// the page, at its own width.

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ImagesIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { isActiveSession } from '@kernel/domain/session-container/session-container.types';
import { isPairedClient } from '../../../domain/pairing/pairing.types';
import { usePairedList } from '../shared/pairing/hooks/usePairedList';
import {
  getLocalStorage,
  setLocalStorage,
} from '../../../application/client-device-storage/local-storage-adapter/localStorage.adapter';
import { activationLatchKey } from '../../../application/client-device-storage/storage-keys.config';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { buildRoute } from '../../../application/routing/buildRoute';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import { StatusPillAtom } from '../../components/StatusPill/StatusPill.atom';
import { ImportantNoteLineMolecule } from '../shared/notes/ImportantNoteLine.molecule';
import { useClientImportantNote } from '../shared/notes/hooks/useClientImportantNote';
import { useSessionDetail } from './hooks/useSessionDetail';
import { useStylistSessionNote } from './hooks/useStylistSessionNote';
import { useTrackSessionOpened } from './hooks/useTrackSessionOpened';
import { StylistCloseSessionOrganism } from './SessionDetailPage.close.organism';
import {
  useClientSessions,
  flattenClientSessionPages,
} from './hooks/useClientSessions';
import {
  getLifecycleLabel,
  getLifecycleColor,
  shouldPulseStatus,
} from './ClientSessionsPage.formatters';
import { formatTimeSinceShared } from './sessionTime.formatters';
import { SessionExpiryMolecule } from './components/SessionExpiry.molecule';
import {
  ClientCreditCardMolecule,
  FirstSessionTipMolecule,
  SessionDetailSkeletonMolecule,
} from './SessionDetailPage.parts.molecule';
import {
  ClientNoteCalloutMolecule,
  StylistNoteCalloutMolecule,
} from './SessionDetailPage.blocks.molecule';
import { ArchiveSectionOrganism } from './SessionDetailPage.archive.organism';
import { SessionPhotosOrganism } from './SessionPhotos.organism';
import { SessionAcceptanceActionsMolecule } from './SessionAcceptanceActions.molecule';
import styles from './SessionDetailPage.module.css';

/* ─── Types ─── */

interface InboxSessionInnerProps {
  sessionId: string;
}

/* ─── Inner component (reads sessionId, orchestrates the editorial blocks) ─── */

function InboxSessionInner({ sessionId }: InboxSessionInnerProps) {
  const t = useTranslations('pages.sessions');
  const router = useRouter();
  const {
    data: session,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useSessionDetail(sessionId);
  // The way from the session to the person: her card and the conversation.
  // The pair list is keyed by user id, the session carries it as clientUserId.
  const { pairs } = usePairedList();
  const { data: allSessionsData } = useClientSessions();
  const allSessions = flattenClientSessionPages(allSessionsData);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const note = useStylistSessionNote(sessionId, session);
  // „Ważne przed wizytą”: her own read of her own note (stylist endpoint), NOT a field of the
  // shared session DTO, so nothing of it can reach the client's copy of this session.
  const importantNote = useClientImportantNote(session?.clientUserId ?? null);
  useTrackSessionOpened(sessionId, session);
  const [showFirstSession, setShowFirstSession] = useState(false);
  const { data: currentUser } = useCurrentUserAccount();
  const sessionTipKey = currentUser?.id
    ? `${activationLatchKey(currentUser.id)}:session-tip`
    : null;

  useAppBarTitle(session?.name ?? t('sessionTitle'));

  useEffect(() => {
    setShowFirstSession(
      sessionTipKey !== null && !getLocalStorage(sessionTipKey)
    );
  }, [sessionTipKey]);

  if (isLoading) {
    return <SessionDetailSkeletonMolecule />;
  }

  // Full error only without a cached session — a failed refetch (the refresh
  // button, window focus) keeps `data` and must not hide the session and the
  // stylist's half-written note behind a retry slab.
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
          title={t('sessionNotFoundStylist')}
          titleAs='h2'
          action={
            <ButtonAtom
              variant='outlined'
              size='md'
              onClick={() => void router.push(ROUTES_FRONT.SHARED)}>
              {t('backToSessions')}
            </ButtonAtom>
          }
        />
      </div>
    );
  }

  // DECISION: pastSessions is ALWAYS empty today, so ArchiveSectionOrganism (relationship
  // continuity, "past sessions with this client") renders null. allSessions comes from get-my,
  // whose stylist branch returns ONLY SHARED/ACTIVE sessions (session-container-queries:
  // SHARED_STATES_FOR_PRISMA), and the partial-unique index session_container_active_pair_uq allows
  // at most one non-terminal session per (client, stylist), i.e. the current one, which the `s.id
  // !== session.id` filter excludes. The terminal sessions (CLOSED/EXPIRED) this section needs as a
  // CRM archive are NOT returned to the stylist by get-my. The scaffolding stays (a designed
  // feature with graceful null-render), but real feeding needs a SEPARATE "terminal sessions of the
  // stylist per client" endpoint; get-my in its current scope cannot feed it. Do NOT re-flag as a
  // bug.
  const pastSessions = allSessions.filter(
    s => s.clientAccountId === session.clientAccountId && s.id !== session.id
  );

  function handleRefresh() {
    setIsRefreshing(true);
    void refetch().finally(() => {
      window.setTimeout(() => setIsRefreshing(false), 600);
    });
  }

  const openPhoto = (galleryRecordId: string) => {
    void router.push(
      buildRoute(ROUTES_FRONT.PHOTO_DETAIL, { id: galleryRecordId })
    );
  };

  const clientPair =
    session.clientUserId !== null
      ? pairs
          .filter(isPairedClient)
          .find(pair => pair.user_id === session.clientUserId)
      : undefined;
  const sharedText = formatTimeSinceShared(session.sharedAt, t);
  // No expiry until the client shares the session: the atom then shows the
  // caller's waiting line. (owner)

  const refreshAction = (
    <ButtonAtom
      variant='outlined'
      size='md'
      onClick={handleRefresh}
      disabled={isRefreshing}
      aria-busy={isRefreshing}>
      {t('refreshBtn')}
    </ButtonAtom>
  );

  return (
    <div className={styles.page}>
      {/* The hero carries the SESSION (name, state, dates); the sender has her
          own row below. The facts are ONE meta member with a gap between
          them, so no separator glyph is drawn. */}
      <AppHeroOrganism
        title={session.name ?? t('inboxHeroTitleFallback')}
        meta={
          <span data-breakable=''>
            <span className={styles.heroFacts}>
              {/* One name per state on the stylist's side: her list calls
                  an open session „Aktywna”, so this pill does too (the
                  client's word for the same state is „Udostępniona”). */}
              <StatusPillAtom
                color={getLifecycleColor(session.lifecycleState)}
                label={
                  isActiveSession(session.lifecycleState)
                    ? t('statusActive')
                    : getLifecycleLabel(session.lifecycleState, t)
                }
                pulse={shouldPulseStatus(session.lifecycleState)}
              />
              {sharedText.length > 0 && (
                <span className={styles.heroFact}>
                  {t('inboxReceivedMeta', { time: sharedText })}
                </span>
              )}
              <span className={styles.heroNote}>
                <SessionExpiryMolecule
                  expiresAt={session.expiresAt}
                  emptyLabel={t('waitingForClient')}
                />
              </span>
            </span>
          </span>
        }
      />

      <SessionAcceptanceActionsMolecule
        sessionId={session.id}
        canAccept={session.can_accept === true}
        acceptedAt={session.accepted_at}
        changedAt={session.last_client_change_at}
      />

      {/* The one thing she must not miss stands first, above who sent it. */}
      <ImportantNoteLineMolecule note={importantNote.data?.note} />

      {isError && (
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={t('retryBtn')}
          onRetry={handleRefresh}
          isRetrying={isRefreshing}
        />
      )}

      <PageColumnsMolecule
        main={
          <>
            {/* Sender identity. clientName is hydrated by the backend; the
                generic label is only the fallback when the client set no
                name. */}
            <ClientCreditCardMolecule
              clientName={session.clientName?.trim() || t('clientLabel')}
              {...(clientPair !== undefined
                ? {
                    cardHref: buildRoute(ROUTES_FRONT.CLIENT_CARD, {
                      id: clientPair.user_id,
                    }),
                    messageHref: `${buildRoute(ROUTES_FRONT.MESSAGES_THREAD, {
                      pairId: clientPair.id,
                    })}?fromSession=1`,
                  }
                : {})}
              t={t}
            />
            {/* Her words come BEFORE the photos: „coś ze złotem, krótsze” is
                what the stylist needs first, and under four photos and the
                tip it was three screens down on a phone. */}
            <ClientNoteCalloutMolecule clientNote={session.clientNote} t={t} />
            <SessionPhotosOrganism
              photos={session.photos}
              onOpenPhoto={openPhoto}
              label={t('inboxInspirationsLabel')}
              countLabel={t('photoCount', { count: session.photos.length })}
              heroAlt={t('inspirationAlt')}
              thumbAlt={t('inspirationAlt')}
              ownAuthorAccountId={session.stylistAccountId}
              empty={
                <EmptyStateAtom
                  size='panel'
                  role='status'
                  icon={<ImagesIcon size={32} weight='duotone' />}
                  title={t('clientNoPhotosYet')}
                  titleAs='p'
                  description={t('clientNoPhotosHint')}
                  action={refreshAction}
                />
              }
            />
          </>
        }
        aside={
          <>
            {showFirstSession && (
              <FirstSessionTipMolecule
                onAcknowledge={() => {
                  if (sessionTipKey !== null) {
                    setLocalStorage(sessionTipKey, 'true');
                  }
                  setShowFirstSession(false);
                }}
                t={t}
              />
            )}
            <StylistNoteCalloutMolecule
              noteValue={note.value}
              onChange={note.setValue}
              onBlur={note.saveOnBlur}
              isSaving={note.isSaving}
              saveFailed={note.saveFailed}
              onRetrySave={note.retry}
              dirty={note.dirty}
              acknowledged={note.acknowledged}
              t={t}
            />
            {/* Past sessions with the same client (relationship continuity). */}
            <ArchiveSectionOrganism pastSessions={pastSessions} t={t} />
          </>
        }
      />

      {isActiveSession(session.lifecycleState) && (
        <StylistCloseSessionOrganism sessionId={session.id} />
      )}
    </div>
  );
}

/* ─── Page shell (reads sessionId from router, wraps with AppLayout) ─── */

export function SessionDetailPageComposition() {
  const t = useTranslations('pages.sessions');
  const router = useRouter();
  const sessionId =
    typeof router.query.sessionId === 'string' ? router.query.sessionId : '';

  return (
    <AppLayoutComposition title={t('sessionTitle')}>
      {sessionId ? (
        // key={sessionId}: the inner latches the note once (noteInitialized).
        // A shallow nav between two /app/inbox/session/[id] changes the param
        // in place; without a key React reuses the instance and shows the
        // previous session's note. Keying remounts it so the note re-seeds.
        <InboxSessionInner key={sessionId} sessionId={sessionId} />
      ) : (
        <SessionDetailSkeletonMolecule />
      )}
    </AppLayoutComposition>
  );
}
