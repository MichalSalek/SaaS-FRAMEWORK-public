// UI/features/dashboard/components/ClientDashboard.organism.tsx
// Client dashboard (S126). DOING column: what waits for her (unread
// messages), then her stylists (opening a gallery is the main action of a
// paired client) or the cold start. READING column: shortcuts, notes and the
// role zone. One white list per group instead of three identical cards.

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  ChatsCircleIcon,
  HeartIcon,
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
import { useUnreadMessagesCount } from '../../messaging/hooks/useConversations';
import {
  flattenFavoriteRecordsPages,
  useFavoriteRecords,
} from '../../shared/favorites/hooks/useFavoriteRecords';
import { useDashboardNote } from '../hooks/useDashboardNote';
import { DashboardNoteOrganism } from './DashboardNote.organism';
import { ClientColdStartOrganism } from './ClientColdStart.organism';
import pageStyles from '../DashboardPage.module.css';

interface ClientDashboardProps {
  displayName: string;
  /** Role switcher or the second-account row; closes the reading column. */
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
  const { pairs, isLoading, isError, refetch } = usePairedStylists();
  // EXPLORE_ENABLED (kernel default OFF, parked): when off, /app/explore 404s, so
  // the discovery shortcut must not render. Runtime-reactive.
  const exploreEnabled = usePublicFeatureFlag(
    FEATURE_FLAG_KEYS.EXPLORE_ENABLED
  );
  // F2-F8: the liked count for the line under the greeting. TQ serves it from
  // cache after a visit to favourites (staleTime 60s in the hook).
  const { data: favData, hasNextPage: hasMoreFavorites } = useFavoriteRecords();
  // Pierwsza strona (20) to dolne ograniczenie, nie „pełny licznik" — przy
  // kolejnych stronach copy mówi „ponad N".
  const favoritesCount = flattenFavoriteRecordsPages(favData).length;
  const favoritesLowerBound = hasMoreFavorites === true;
  // Hook przed early-return (rules-of-hooks); poll co 30s przez współdzielony
  // klucz conversations.
  const unreadMessages = useUnreadMessagesCount();
  // DECISION (nie usuwaj tego komentarza): notatnik jest MODUŁEM PARY, nie
  // powitaniem. Klientce bez sparowanej stylistki dokładał pod zimnym startem
  // pustą kartę „Twoje prywatne notatki…" — moduł bez celu (nie ma o kim
  // notować) i odsuwał od głównej akcji to, co po niej następuje.
  // Ukrywamy go TYLKO gdy jest realnie pusty: notatka przeżywa rozłączenie
  // stylistki, a wtedy schowanie karty ukryłoby TREŚĆ UŻYTKOWNICZKI. Ten sam
  // klucz TanStack Query co w DashboardNote — jedno zapytanie, nie dwa.
  const { note: clientNote } = useDashboardNote(AccountTypeValue.CLIENT);
  // Resilient displayName fallback chain (DECISION: nie usuwaj tego komentarza):
  // 1. prop displayName (from Better Auth session — fastest path),
  // 2. server-side CurrentUser query (works when session hook stalls due to
  //    cross-origin baseURL in dev / cookie-less WebView),
  // 3. email local-part (last resort so we still get a personalised greeting).
  const { data: currentUser } = useCurrentUserAccount();
  const fallbackName =
    currentUser?.name?.split(' ')[0] ??
    (currentUser?.email ? currentUser.email.split('@')[0] : '');
  const resolvedName = displayName || fallbackName;

  if (isLoading) {
    return <ClientDashboardSkeleton />;
  }

  const hasPairs = pairs.length > 0;
  const hasNote = clientNote != null && clientNote !== '';

  // S26 census: hero niesie ŻYWE DANE (meta), nie marketing-subtitle.
  // Człon stylistek znika tylko, gdy query padło i nie ma nic w cache
  // (inaczej "brak połączonych stylistek" kłamałoby przy błędzie sieci);
  // człon polubionych — dopiero gdy favorites realnie załadowane.
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
    primary = <ClientColdStartOrganism />;
  } else {
    primary = (
      // S126: the name is the row, the disc says it opens. The raspberry
      // heart disc that led each row read as a „favourite” switch.
      // User-eyes review 2026-10-09: the row leads with the stylist's avatar
      // (as on „Połącz”, „Polubione” and the profile) and says in words where
      // it goes; a bare name with an arrow left the reader guessing between
      // her profile, her works and a chat.
      <NavRowListMolecule label={t('pairedStylists')}>
        {pairs.map(pair =>
          pair.isInactive ? (
            <li key={pair.stylistAccountId} className={pageStyles.staticRow}>
              {tPairing('inactiveAccount')}
            </li>
          ) : (
            <NavRowMolecule
              key={pair.stylistAccountId}
              // Galeria stylistki W APLIKACJI, nie publiczny profil: publiczna
              // trasa zdejmowała dolną belkę i zamykała klientkę w nagłówku
              // marketingowym (S122).
              href={buildRoute(ROUTES_FRONT.STYLIST_GALLERY, {
                id: pair.stylistAccountId,
              })}
              leading={
                <AvatarAtom
                  name={pair.stylistDisplayName}
                  size='md'
                  decorative
                />
              }
              label={pair.stylistDisplayName}
              description={t('stylistRowHint')}
              trailing='disc'
            />
          )
        )}
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
        <DashboardNoteOrganism accountType={AccountTypeValue.CLIENT} />
        {roleZone}
      </>
    ) : (
      roleZone
    );

  return (
    <div className={pageStyles.page}>
      <AppHeroOrganism
        title={resolvedName ? `${t('welcomeBack')},` : `${t('welcomeBack')}.`}
        {...(resolvedName ? { accentInline: resolvedName } : {})}
        meta={hasPairs ? heroMeta : undefined}
      />
      <PageColumnsMolecule
        main={
          <>
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
