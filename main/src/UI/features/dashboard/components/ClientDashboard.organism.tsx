// UI/features/dashboard/components/ClientDashboard.organism.tsx
// Client dashboard. DOING column: what waits for her (unread messages), then her stylists (opening a
// gallery is the main action of a paired client) or the cold start. READING column: shortcuts,
// notes and the role zone. One white list per group instead of three identical cards.

import { SalonMembershipWaitingMolecule } from '../../shared/salon-staff/SalonMembershipWaiting.molecule';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  ChatsCircleIcon,
  HeartIcon,
  ImagesIcon,
  MagnifyingGlassIcon,
} from '@phosphor-icons/react';
import { buildRoute } from '../../../../application/routing/buildRoute';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import { usePublicFeatureFlag } from '../../../../application/feature-flags/client-feature-flags';
import { AvatarAtom } from '../../../components/Avatar/Avatar.atom';
import { SkeletonAtom } from '../../../components/Skeleton/Skeleton.atom';
import { AppHeroOrganism } from '../../../components/AppHero/AppHero.organism';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';
import { PageColumnsMolecule } from '../../../components/PageColumns/PageColumns.molecule';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../../components/NavRow/NavRow.molecule';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { usePairedStylists } from '../../shared/pairing/hooks/usePairedStylists';
import { useMyPendingRequests } from '../../shared/pairing/hooks/usePairRequests';
import { useUnreadMessagesCount } from '../../shared/messaging/hooks/useConversations';
import {
  flattenFavoriteRecordsPages,
  useFavoriteRecords,
} from '../../shared/favorites/hooks/useFavoriteRecords';
import { useDashboardNote } from '../../shared/notes/hooks/useDashboardNote';
import { DashboardNoteOrganism } from '../../shared/notes/DashboardNote.organism';
import { ClientColdStartOrganism } from './ClientColdStart.organism';
import { ClientPendingRequestsOrganism } from './ClientPendingRequests.organism';
import pageStyles from '../DashboardPage.module.css';

interface ClientDashboardProps {
  displayName: string;
  /** Switcher for two active modes; closes the reading column. */
  roleZone: ReactNode;
}

/* --- Skeleton: hero and the stylists list keep their final boxes. --- */

function ClientDashboardSkeleton() {
  return (
    <div className={pageStyles.page} aria-busy='true' aria-live='polite'>
      <AppHeroOrganism
        title={<SkeletonAtom variant='text' width='60%' height={32} />}
        meta={
          <span>
            <SkeletonAtom variant='text' width={160} height={14} />
          </span>
        }
      />
      <div className={pageStyles.skeletonList}>
        <SkeletonAtom variant='text' width='40%' height={20} />
        <SkeletonAtom variant='rect' width='100%' height={104} />
      </div>
      <SkeletonAtom variant='rect' width='100%' height={156} />
    </div>
  );
}

export function ClientDashboardOrganism({
  displayName,
  roleZone,
}: ClientDashboardProps) {
  const t = useTranslations('dashboard.client');
  const tPairing = useTranslations('pages.pairing');
  const tButtons = useTranslations('buttons');
  const tLabels = useTranslations('labels');
  const tNote = useTranslations('pages.app.dashboardNote');
  const { pairs, isLoading, isError, refetch } = usePairedStylists();
  const pendingRequests = useMyPendingRequests(true);
  // EXPLORE_ENABLED (kernel default OFF, parked): when off, /app/explore 404s, so
  // the discovery shortcut must not render. Runtime-reactive.
  const exploreEnabled = usePublicFeatureFlag(
    FEATURE_FLAG_KEYS.EXPLORE_ENABLED
  );
  // The liked count for the line under the greeting. TQ serves it from
  const { data: favData, hasNextPage: hasMoreFavorites } = useFavoriteRecords();
  // The first page (20) is a lower bound, not a „full count" — with more pages the copy says
  // „ponad N".
  const favoritesCount = flattenFavoriteRecordsPages(favData).length;
  const favoritesLowerBound = hasMoreFavorites === true;
  // Hook before the early return (rules-of-hooks); polls every 30s through the shared
  // conversations key.
  const unreadMessages = useUnreadMessagesCount();
  // DECISION: the notebook is a PAIR module, not a greeting. For a client without a paired stylist
  // it added an empty "private notes" card under the cold start: a module with no purpose (nobody
  // to take notes about) that pushed away what follows the main action. It is hidden ONLY when
  // really empty: a note survives the stylist disconnecting, and hiding the card then would hide
  // the USER'S CONTENT. Same TanStack Query key as DashboardNote: one query, not two.
  const { note: clientNote } = useDashboardNote(AccountTypeValue.CLIENT);
  // displayName fallback chain: 1. the prop (Better Auth session, fastest), 2. the server-side
  // CurrentUser query (works when the session hook stalls on a cross-origin baseURL in dev /
  // cookie-less WebView), 3. nothing: "Witaj." (the e-mail local part is not a name).
  const { data: currentUser } = useCurrentUserAccount();
  const fallbackName = currentUser?.name?.split(' ')[0] ?? '';
  const resolvedName = displayName || fallbackName;

  if (isLoading) {
    return <ClientDashboardSkeleton />;
  }

  const hasPairs = pairs.length > 0;
  const hasNote = clientNote != null && clientNote !== '';

  // The hero carries LIVE DATA (meta), not a marketing subtitle. The stylists segment disappears only
  // when the query failed and there is nothing in the cache (otherwise „no connected stylists" would
  // lie on a network error); the liked segment only once favorites are really loaded.
  const showStylistsMeta = !isError || hasPairs;
  const showSavedMeta = favData != null;
  const heroMeta =
    showStylistsMeta || showSavedMeta ? (
      <>
        {showStylistsMeta && (
          <span>{t('heroMetaStylists', { count: pairs.length })}</span>
        )}
        {showSavedMeta && (
          <span>
            {favoritesLowerBound
              ? t('heroMetaSavedMore', { count: favoritesCount })
              : t('heroMetaSaved', { count: favoritesCount })}
          </span>
        )}
      </>
    ) : undefined;

  // One messages row: in the waiting list while something is unread (also for
  // a thread from a PENDING pair, so it shows without an active stylist),
  // among the shortcuts otherwise.
  const messagesRow = (
    <NavRowMolecule
      href={ROUTES_FRONT.MESSAGES}
      icon={<ChatsCircleIcon />}
      label={t('messagesTitle')}
      description={t('messagesBody')}
      badge={{
        count: unreadMessages,
        ariaLabel: t('messagesUnread', { count: unreadMessages }),
      }}
      trailing='disc'
    />
  );

  /* Error + retry when the pairs query failed with nothing cached (otherwise
     an empty array would render the cold start and tell a paired client she
     has no stylists). Then the cold start, then the stylists. */
  let primary: ReactNode;
  if (isError && !hasPairs) {
    primary = (
      <ErrorStateMolecule
        message={t('pairsLoadError')}
        retryLabel={tButtons('retry')}
        onRetry={() => void refetch()}
      />
    );
  } else if (!hasPairs) {
    primary = (
      <ClientColdStartOrganism
        pendingCount={pendingRequests.data?.requests.length}
      />
    );
  } else {
    primary = (
      // The name is the row, the disc says it opens. The raspberry heart disc that led each row read
      // as a „favourite” switch. The row leads with the stylist's avatar (as on „Połącz”, „Polubione”
      // and the profile) and says in words where it goes; a bare name with an arrow left the reader
      // guessing between her profile, her works and a chat.
      <NavRowListMolecule label={t('pairedStylists')}>
        {pairs.map(pair => {
          // A stylist onboarded with the role alone has no name yet.
          const name = pair.stylistDisplayName || tLabels('stylistFallback');
          return pair.isInactive ? (
            <li key={pair.stylistAccountId} className={pageStyles.staticRow}>
              {tPairing('inactiveAccount')}
            </li>
          ) : (
            <NavRowMolecule
              key={pair.stylistAccountId}
              // The stylist's gallery INSIDE the app, not the public profile: the public route removed
              // the bottom bar and shut the client in a marketing header.
              href={buildRoute(ROUTES_FRONT.STYLIST_GALLERY, {
                id: pair.stylistAccountId,
              })}
              leading={<AvatarAtom name={name} size='md' decorative />}
              label={name}
              description={t('stylistRowHint')}
              trailing='disc'
            />
          );
        })}
      </NavRowListMolecule>
    );
  }

  const aside =
    hasPairs || hasNote ? (
      <>
        {/* Shortcuts only for a PAIRED client: before pairing favourites are
            empty and explore is parked. */}
        {hasPairs && (
          <NavRowListMolecule ariaLabel={t('shortcutsLabel')}>
            {/* A connected client found no way to prepare a visit here (user-eyes review: sessions
                            lived only in „Więcej”). */}
            <NavRowMolecule
              href={ROUTES_FRONT.CLIENT_SESSIONS}
              icon={<ImagesIcon />}
              label={t('sessionsTitle')}
              description={t('sessionsHint')}
              trailing='disc'
            />
            <NavRowMolecule
              href={ROUTES_FRONT.FAVORITES}
              icon={<HeartIcon />}
              label={t('savedInspirations.title')}
              description={t('favoritesHint')}
              trailing='disc'
            />
            {exploreEnabled && (
              <NavRowMolecule
                href={ROUTES_FRONT.EXPLORE}
                icon={<MagnifyingGlassIcon />}
                label={t('exploreTitle')}
                description={t('exploreBody')}
                trailing='disc'
              />
            )}
            {unreadMessages < 1 && messagesRow}
          </NavRowListMolecule>
        )}
        <DashboardNoteOrganism
          accountType={AccountTypeValue.CLIENT}
          copy={{
            title: tNote('title'),
            placeholder: tNote('placeholder'),
            hint: tNote('hint'),
          }}
        />
        {roleZone}
      </>
    ) : (
      roleZone
    );

  // „Witaj ponownie” greeted a client on her very first visit; until she has a
  // stylist, mirror the stylist dashboard's first-time greeting.
  const greeting = hasPairs ? t('welcomeBack') : t('welcomeFirst');

  return (
    <div className={pageStyles.page}>
      <AppHeroOrganism
        title={resolvedName ? `${greeting},` : `${greeting}.`}
        {...(resolvedName ? { accentInline: resolvedName } : {})}
        meta={hasPairs ? heroMeta : undefined}
      />
      <SalonMembershipWaitingMolecule />
      <PageColumnsMolecule
        main={
          <>
            <ClientPendingRequestsOrganism query={pendingRequests} />
            {unreadMessages >= 1 && (
              <NavRowListMolecule label={t('waitingLabel')}>
                {messagesRow}
              </NavRowListMolecule>
            )}
            {primary}
          </>
        }
        aside={aside}
      />
    </div>
  );
}
