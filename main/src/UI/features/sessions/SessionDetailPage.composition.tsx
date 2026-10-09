// UI/features/sessions/SessionDetailPage.composition.tsx
// Stylist view of a session shared by a client.
// Route: /app/inbox/session/[sessionId]
//
// Layout (top → bottom on a phone):
//   1. AppHero         — session name + status, when received, when it expires
//   2. Main column     — who sent it (with refresh) + her photos
//   3. Second column   — one-time tip, her message, the stylist's private
//                        note, earlier sessions with this client
// From 720px of the page's own width 2 and 3 stand side by side (PageColumns).
// The screen has no filled button: it is read first, and its only input is
// the private note.

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ImagesIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  getLocalStorage,
  setLocalStorage,
} from '../../../application/client-device-storage/local-storage-adapter/localStorage.adapter';
import { STORAGE_KEYS } from '../../../application/client-device-storage/storage-keys.config';
import { buildRoute } from '../../../application/routing/buildRoute';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import { StatusPillAtom } from '../../components/StatusPill/StatusPill.atom';
import { useSessionDetail } from './hooks/useSessionDetail';
import { useUpdateSessionNote } from './hooks/useUpdateSessionNote';
import {
  useClientSessions,
  flattenClientSessionPages,
} from './hooks/useClientSessions';
import {
  getLifecycleLabel,
  getLifecycleColor,
  shouldPulseStatus,
} from './ClientSessionsPage.formatters';
import {
  formatExpiryRemaining,
  formatTimeSinceShared,
} from './sessionTime.formatters';
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
  const { data: allSessionsData } = useClientSessions();
  const allSessions = flattenClientSessionPages(allSessionsData);
  const updateNote = useUpdateSessionNote(sessionId);

  const [noteValue, setNoteValue] = useState('');
  const [noteInitialized, setNoteInitialized] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Save-on-blur has no button, so a failed save must leave a mark next to the
  // note (the interceptor toast disappears; the text stays in the field).
  const [noteSaveFailed, setNoteSaveFailed] = useState(false);
  // Latest typed value, read after a save settles: an edit made while the
  // previous save was in flight is otherwise never sent (blur is ignored
  // during a pending save).
  const latestNote = useRef(noteValue);
  latestNote.current = noteValue;
  const [showFirstSession, setShowFirstSession] = useState(false);

  useAppBarTitle(session?.name ?? t('sessionTitle'));

  useEffect(() => {
    setShowFirstSession(
      !getLocalStorage(STORAGE_KEYS.FIRST_SESSION_CELEBRATED)
    );
  }, []);

  useEffect(() => {
    if (session && !noteInitialized) {
      setNoteValue(session.stylistNote ?? '');
      setNoteInitialized(true);
    }
  }, [session, noteInitialized]);

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

  const existingStylistNote = session.stylistNote ?? '';
  // DECISION (nie usuwaj tego komentarza): pastSessions jest DZIŚ zawsze puste, więc
  // ArchiveSectionOrganism (relationship-continuity, „przeszłe sesje z tą klientką")
  // renderuje null. Powód: allSessions pochodzi z get-my, którego branch stylistki zwraca
  // WYŁĄCZNIE sesje SHARED/ACTIVE (session-container-queries: SHARED_STATES_FOR_PRISMA), a
  // partial-unique index session_container_active_pair_uq dopuszcza max 1 niesterminalną
  // sesję per (klientka,stylistka) — czyli bieżącą, którą filtr `s.id !== session.id`
  // wyklucza. Terminalne (CLOSED/EXPIRED) — których ta sekcja potrzebuje jako CRM-archiwum
  // (SCCAP-3) — get-my stylistce NIE zwraca. Scaffolding zostaje (zaprojektowany feature +
  // graceful null-render), ale realne zasilenie wymaga OSOBNEGO endpointu „terminalne sesje
  // stylistki per klientka"; get-my w obecnym scope go nie nakarmi. NIE re-flagować jako bug.
  const pastSessions = allSessions.filter(
    s => s.clientAccountId === session.clientAccountId && s.id !== session.id
  );

  function handleRefresh() {
    setIsRefreshing(true);
    void refetch().finally(() => {
      window.setTimeout(() => setIsRefreshing(false), 600);
    });
  }

  function saveNote(value: string) {
    updateNote.mutate(value, {
      onSuccess: () => {
        setNoteSaveFailed(false);
        if (latestNote.current.trim() !== value.trim()) {
          saveNote(latestNote.current);
        }
      },
      onError: () => setNoteSaveFailed(true),
    });
  }

  function handleSaveNote() {
    // No-op guard on save-on-blur. Backend trims + stores whitespace as null, and
    // existingStylistNote IS that stored (trimmed/empty) value — so skip the POST
    // when the trimmed input already equals it. Covers BOTH an unchanged focus/blur
    // (which otherwise re-POSTed identical content → spurious 'note saved' toast +
    // full sessionContainer.all refetch every cycle) AND the original empty-and-no-
    // existing case. Also bail while a save is in flight to avoid overlap.
    if (updateNote.isPending || noteValue.trim() === existingStylistNote) {
      return;
    }
    saveNote(noteValue);
  }

  const openPhoto = (galleryRecordId: string) => {
    void router.push(
      buildRoute(ROUTES_FRONT.PHOTO_DETAIL, { id: galleryRecordId })
    );
  };

  const sharedText = formatTimeSinceShared(session.sharedAt, t);
  // No expiry until the client shares the session: the label then says so.
  const timerText = formatExpiryRemaining(
    session.expiresAt,
    t,
    t('waitingForClient')
  );

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
              <StatusPillAtom
                color={getLifecycleColor(session.lifecycleState)}
                label={getLifecycleLabel(session.lifecycleState, t)}
                pulse={shouldPulseStatus(session.lifecycleState)}
              />
              {sharedText.length > 0 && (
                <span className={styles.heroFact}>
                  {t('inboxReceivedMeta', { time: sharedText })}
                </span>
              )}
              <span className={styles.heroFact}>{timerText}</span>
            </span>
          </span>
        }
      />

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
              onRefresh={handleRefresh}
              isRefreshing={isRefreshing}
              t={t}
            />
            <SessionPhotosOrganism
              photos={session.photos}
              onOpenPhoto={openPhoto}
              label={t('inboxInspirationsLabel')}
              countLabel={t('photoCount', { count: session.photos.length })}
              heroAlt={t('inspirationAlt')}
              thumbAlt={t('inspirationAlt')}
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
                  setLocalStorage(
                    STORAGE_KEYS.FIRST_SESSION_CELEBRATED,
                    'true'
                  );
                  setShowFirstSession(false);
                }}
                t={t}
              />
            )}
            <ClientNoteCalloutMolecule clientNote={session.clientNote} t={t} />
            <StylistNoteCalloutMolecule
              noteValue={noteValue}
              onChange={setNoteValue}
              onBlur={handleSaveNote}
              isSaving={updateNote.isPending}
              saveFailed={
                noteSaveFailed &&
                !updateNote.isPending &&
                noteValue.trim() !== existingStylistNote
              }
              onRetrySave={() => saveNote(noteValue)}
              t={t}
            />
            {/* Past sessions with the same client (relationship continuity). */}
            <ArchiveSectionOrganism pastSessions={pastSessions} t={t} />
          </>
        }
      />
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
