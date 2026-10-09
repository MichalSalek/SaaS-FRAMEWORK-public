// UI/features/sessions/ClientSessionsPage.composition.tsx
// The client's inspiration sessions.
// - AppHero: title + live counts (open, archived)
// - the one filled action „Utwórz sesję”, right under the hero
// - open sessions (drafts first) in the main column, history by month in the
//   second column from 720px of the page's own width (PageColumns)
// - empty state with the same single action when there is nothing yet
//
// Data: TanStack Query v5 useInfiniteQuery with cursor pagination.

import { useState, useMemo } from 'react';
import { useRouter } from 'next/router';
import { useTranslations, useLocale } from 'next-intl';
import { PlusIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../application/routing/buildRoute';
import type { SessionContainerDTO } from '@kernel/models/session-container/session-container.dto';
import {
  isActiveSession,
  isTerminalSession,
} from '@kernel/domain/session-container/session-container.types';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import {
  CreateSessionModalOrganism,
  resolveStylistsStatus,
} from '../../components/CreateSessionModal/CreateSessionModal.organism';
import type {
  StylistOption,
  StylistsStatus,
} from '../../components/CreateSessionModal/CreateSessionModal.organism';
import { usePairedStylists } from '../shared/pairing/hooks/usePairedStylists';
import {
  useClientSessions,
  flattenClientSessionPages,
} from './hooks/useClientSessions';
import { InfiniteScrollTriggerComposition } from '../../components/InfiniteScrollTrigger.composition';
import { useCreateSession } from './hooks/useCreateSession';
import {
  ActiveSessionsBlockOrganism,
  SessionsEmptyStateOrganism,
  SessionsListSkeletonOrganism,
  TimelineSectionOrganism,
} from './ClientSessionsPage.blocks.organism';
import {
  buildUnnamedDayCollisionTimes,
  monthKey,
  sessionTimestamp,
} from './ClientSessionsPage.formatters';
import styles from './ClientSessionsPage.module.css';

/* ============================================================
 * Inner Page — owns the data layer
 * ============================================================ */

function ClientSessionsPageInner() {
  const t = useTranslations('pages.sessions');
  const tPairing = useTranslations('pages.pairing');
  const locale = useLocale();
  useAppBarTitle(t('mySessionsTitle'));
  const router = useRouter();
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const {
    data,
    isLoading,
    isError,
    refetch,
    isFetching,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  } = useClientSessions();
  const createSessionMutation = useCreateSession();
  const pairedStylists = usePairedStylists();
  const { pairs } = pairedStylists;
  // Each row names the stylist its session is for (connected ones only).
  const stylistNames = useMemo(
    () => new Map(pairs.map(p => [p.stylistAccountId, p.stylistDisplayName])),
    [pairs]
  );
  // The modal must tell „pairs unknown" from „no pairs": an empty `pairs` on a
  // failed or pending fetch used to render „no paired stylists, pair anew".
  const stylistsStatus: StylistsStatus = resolveStylistsStatus(pairedStylists);

  const sessions = useMemo(() => flattenClientSessionPages(data), [data]);

  // Open sessions, the ones that wait for HER first: a draft is not shared
  // yet, a shared one merely exists until the visit. The filter is stable, so
  // the API order (newest first) holds inside each group.
  const activeSessions = useMemo(() => {
    const open = sessions.filter(s => !isTerminalSession(s.lifecycleState));
    return [
      ...open.filter(s => !isActiveSession(s.lifecycleState)),
      ...open.filter(s => isActiveSession(s.lifecycleState)),
    ];
  }, [sessions]);

  const archiveSessions = useMemo(
    () => sessions.filter(s => isTerminalSession(s.lifecycleState)),
    [sessions]
  );

  /* DECISION (nie usuwaj tego komentarza):
   * Group archive sessions by month (YYYY-MM) using the most meaningful
   * timestamp (sharedAt > closedAt > createdAt). Use a stable Map to
   * preserve descending insertion order from the cursor-paginated API.
   * Each group renders with a sticky month header — narrative flow. */
  const archiveByMonth = useMemo<
    ReadonlyArray<readonly [string, SessionContainerDTO[]]>
  >(() => {
    const map = new Map<string, SessionContainerDTO[]>();
    for (const s of archiveSessions) {
      const key = monthKey(sessionTimestamp(s));
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const ta = new Date(sessionTimestamp(a)).getTime();
        const tb = new Date(sessionTimestamp(b)).getTime();
        // NaN-safe descending sort: invalid timestamps go to the end (-1/+1)
        // instead of producing NaN which destabilises sort order.
        if (Number.isNaN(ta) && Number.isNaN(tb)) {
          return 0;
        }
        if (Number.isNaN(ta)) {
          return 1;
        }
        if (Number.isNaN(tb)) {
          return -1;
        }
        return tb - ta;
      });
    }
    return Array.from(map.entries());
  }, [archiveSessions]);

  // Disambiguate UNNAMED sessions that share a calendar day with another
  // unnamed session (owner vote S27 #3, variant A). Computed once over the
  // FULL list (active + archive) so a same-day collision straddling the
  // active/archive split or a month boundary is still detected. id -> "HH:MM".
  const disambiguationTimes = useMemo(
    () => buildUnnamedDayCollisionTimes(sessions, locale),
    [sessions, locale]
  );

  // Stylist options for the CreateSessionModal. stylistAccountId → id of the
  // open session with her, so a blocked row can lead INTO that session.
  const activeSessionIdByStylist = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of activeSessions) {
      if (s.stylistAccountId !== null && !map.has(s.stylistAccountId)) {
        map.set(s.stylistAccountId, s.id);
      }
    }
    return map;
  }, [activeSessions]);

  const stylistOptions: StylistOption[] = useMemo(
    () =>
      pairs.map(p => ({
        id: p.stylistAccountId,
        name: p.isInactive ? tPairing('inactiveAccount') : p.stylistDisplayName,
        businessName: null,
        avatarUrl: null,
        hasActiveSession: activeSessionIdByStylist.has(p.stylistAccountId),
        activeSessionId:
          activeSessionIdByStylist.get(p.stylistAccountId) ?? null,
      })),
    [pairs, activeSessionIdByStylist, tPairing]
  );

  /* ---------------- Loading / error ---------------- */

  if (isLoading) {
    // The skeleton keeps the final boxes (hero title, the create button, three
    // cards), so nothing shifts when the list arrives.
    return (
      <div className={styles.page} aria-busy='true' aria-live='polite'>
        <AppHeroOrganism title={t('mySessionsTitle')} />
        <SessionsListSkeletonOrganism />
      </div>
    );
  }

  // Full-page error ONLY when there is nothing to show. TanStack keeps `data`
  // on a failed background refetch or next page (isError stays true), and the
  // old unconditional branch threw the loaded sessions away for a retry slab.
  // An EMPTY cached list under an error is not a confirmed "no sessions yet"
  // either: it gets this error with retry, not the create-first empty state.
  if (
    isError &&
    (data === undefined ||
      (activeSessions.length === 0 && archiveSessions.length === 0))
  ) {
    return (
      <div className={styles.page}>
        <AppHeroOrganism title={t('mySessionsTitle')} />
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={t('retryBtn')}
          onRetry={() => void refetch()}
          isRetrying={isFetching}
        />
      </div>
    );
  }

  // Zwraca Promise<boolean> — modal czeka na WYNIK mutacji i przechodzi do kroku
  // „Sesja utworzona" TYLKO na sukcesie. Wcześniej modal odpalał mutację fire-and-forget
  // i synchronicznie pokazywał ekran sukcesu + auto-close, więc porażka (MAX_ACTIVE_EXCEEDED,
  // NOT_PAIRED, sieć) dawała fałszywy „sukces" obok toasta błędu i zero nawigacji.
  const handleCreateSession = (stylistId: string): Promise<boolean> =>
    new Promise<boolean>(resolve => {
      createSessionMutation.mutate(
        { stylist_account_id: stylistId },
        {
          onSuccess: createdData => {
            // Nawigacja na detal nowej sesji = potwierdzenie sukcesu (unmountuje modal
            // po krótkim kroku „done"). buildRoute zamiast ręcznego .replace — spójność
            // z resztą feature'u + encode + compile-time typing paramu.
            void router.push(
              buildRoute(ROUTES_FRONT.CLIENT_SESSION_DETAIL, {
                sessionId: createdData.session.id,
              })
            );
            resolve(true);
          },
          onError: () => resolve(false),
        }
      );
    });

  const isCompletelyEmpty =
    activeSessions.length === 0 && archiveSessions.length === 0;
  const openCreate = () => setCreateModalOpen(true);

  // Live counts of the page. ONE meta member on purpose: AppHero draws a
  // separator between sibling members, and the two counts read as one
  // sentence joined by a comma.
  const more = hasNextPage ? '+' : '';
  const heroMeta = isCompletelyEmpty ? undefined : (
    <span>
      <span>
        {activeSessions.length > 0 && (
          <>
            <strong>
              {activeSessions.length}
              {more}
            </strong>{' '}
          </>
        )}
        {t('heroMetaActive', { count: activeSessions.length })}
        {archiveSessions.length > 0 && (
          <>
            {', '}
            <strong>
              {archiveSessions.length}
              {more}
            </strong>{' '}
            {t('heroMetaArchive')}
          </>
        )}
      </span>
    </span>
  );

  const activeBlock =
    activeSessions.length > 0 ? (
      <ActiveSessionsBlockOrganism
        sessions={activeSessions}
        locale={locale}
        t={t}
        disambiguationTimes={disambiguationTimes}
        stylistNames={stylistNames}
      />
    ) : null;
  const historyBlock =
    archiveByMonth.length > 0 ? (
      <TimelineSectionOrganism
        monthGroups={archiveByMonth}
        locale={locale}
        t={t}
        disambiguationTimes={disambiguationTimes}
        stylistNames={stylistNames}
      />
    ) : null;

  return (
    <div className={styles.page}>
      <AppHeroOrganism title={t('mySessionsTitle')} meta={heroMeta} />

      {isCompletelyEmpty ? (
        <SessionsEmptyStateOrganism onCreateClick={openCreate} />
      ) : (
        <>
          <div className={styles.primaryAction}>
            <ButtonAtom
              variant='primary'
              size='lg'
              icon={<PlusIcon weight='bold' />}
              className='haptic-press'
              onClick={openCreate}>
              {t('createNew')}
            </ButtonAtom>
          </div>

          {/* Open sessions lead; history is the second column on a wide
              page. With nothing open the history takes the main column. */}
          {activeBlock !== null && historyBlock !== null ? (
            <PageColumnsMolecule main={activeBlock} aside={historyBlock} />
          ) : (
            <PageColumnsMolecule main={activeBlock ?? historyBlock} />
          )}

          {/* Stale list + failed refresh/next page: non-blocking retry. A
              failed next page is retried by itself (refetch would reload
              every page); the sentinel is paused so it cannot loop. */}
          {isError && (
            <ErrorStateMolecule
              message={t('loadError')}
              retryLabel={t('retryBtn')}
              onRetry={() =>
                void (isFetchNextPageError ? fetchNextPage() : refetch())
              }
              isRetrying={isFetchingNextPage || isFetching}
            />
          )}

          {!isFetchNextPageError && (
            <InfiniteScrollTriggerComposition
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              onFetchNextPage={fetchNextPage}
            />
          )}
        </>
      )}

      <CreateSessionModalOrganism
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        stylists={stylistOptions}
        stylistsStatus={stylistsStatus}
        onRetryStylists={() => void pairedStylists.refetch()}
        isRetryingStylists={pairedStylists.isFetching}
        onOpenSession={sessionId =>
          void router.push(
            buildRoute(ROUTES_FRONT.CLIENT_SESSION_DETAIL, { sessionId })
          )
        }
        onCreateSession={handleCreateSession}
        onNavigateToPairing={() => void router.push(ROUTES_FRONT.PAIRING)}
      />
    </div>
  );
}

/* ============================================================
 * Shell with AppLayout
 * ============================================================ */

export function ClientSessionsPageComposition() {
  const t = useTranslations('pages.sessions');
  return (
    <AppLayoutComposition title={t('mySessionsTitle')}>
      <ClientSessionsPageInner />
    </AppLayoutComposition>
  );
}
