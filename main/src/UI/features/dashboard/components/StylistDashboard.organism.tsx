// UI/features/dashboard/components/StylistDashboard.organism.tsx
// Stylist dashboard (S126). Order of the DOING column: what waits for her,
// the one stage action, her clients, shortcuts, the setup checklist. The
// READING column (numbers, share link, notes) is StylistDashboardAside.
// Stack: TQ v5 + CSS Modules + Phosphor Icons.

import type { ReactNode } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { HeartIcon, PlusIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { AppHeroOrganism } from '../../../components/AppHero/AppHero.organism';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { SkeletonAtom } from '../../../components/Skeleton/Skeleton.atom';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';
import { PageColumnsMolecule } from '../../../components/PageColumns/PageColumns.molecule';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../../components/NavRow/NavRow.molecule';
import {
  GalleryStrengthOrganism,
  MAX_STRENGTH_SCORE,
  calculateStrength,
} from '../../../components/GalleryStrength/GalleryStrength.organism';
import { resolveTrialBannerEndsAt } from '../../../components/TrialCountdownBanner/trialCountdown.logic';
import { useDismissGalleryStrength } from '../hooks/useDismissGalleryStrength';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { useDashboardFeed } from '../../shared/dashboard/hooks/useDashboardFeed';
import { useActivationProgress } from '../hooks/useActivationProgress';
import { usePairedList } from '../../shared/pairing/hooks/usePairedList';
import { useUnreadMessagesCount } from '../../messaging/hooks/useConversations';
import { useClientAttention } from '../../shared/pairing/hooks/useClientAttention';
import { ActivationChecklistOrganism } from './StylistDashboard.parts.organism';
import {
  StylistMessagesRowMolecule,
  StylistWaitingListMolecule,
} from './StylistWaitingList.molecule';
import { StylistDashboardAsideOrganism } from './StylistDashboardAside.organism';
import { PairedClientsWidgetOrganism } from './PairedClientsWidget.organism';
import pageStyles from '../DashboardPage.module.css';

interface StylistDashboardProps {
  /** First name from the session (first token of the user's name). */
  displayName: string;
  /** Role switcher or the second-account row; closes the reading column. */
  roleZone: ReactNode;
}

/**
 * DECISION (nie usuwaj tego komentarza) — owner 2026-10-08: the stage decides
 * the ONE filled action. Until she has this many published works it is „Dodaj
 * pracę”; from then on „Pokaż kod klientce” (the gallery is worth showing,
 * so the next gain is a connected client).
 */
const WORKS_BEFORE_SHOWING_CODE = 3;

/* --- Skeleton: hero, the action button and the clients strip keep their
       final boxes, so the loaded screen moves nothing (DASH-10). --- */

function StylistDashboardSkeleton() {
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
      <SkeletonAtom variant='rect' width='100%' height={52} />
      <div className={pageStyles.skeletonList}>
        <SkeletonAtom variant='text' width='45%' height={24} />
        <SkeletonAtom variant='rect' width='100%' height={96} />
      </div>
      <SkeletonAtom variant='rect' width='100%' height={52} />
    </div>
  );
}

export function StylistDashboardOrganism({
  displayName,
  roleZone,
}: StylistDashboardProps) {
  const router = useRouter();
  const t = useTranslations('dashboard.stylist');
  const tButtons = useTranslations('buttons');
  const { feed, isLoading, isError, refetch } = useDashboardFeed();
  const pairsQuery = usePairedList();
  const { pairs, isLoading: pairsLoading } = pairsQuery;
  // Poll co 30s przez współdzielony klucz conversations — hook musi stać
  // przed early-returns (rules-of-hooks).
  const unreadMessages = useUnreadMessagesCount();
  const stripAttention = useClientAttention();
  // DECISION (nie usuwaj tego komentarza): a paired-clients failure stays INSIDE
  // the clients module (persistent error + retry) and never replaces the whole
  // dashboard: the feed (gallery, stats, onboarding) renders independently and
  // stays useful when only the pairs query fails. The earlier snackbar-only
  // variant left the module rendering "0 clients" plus the empty "pair your
  // first client" state under a toast that vanished after a few seconds, which
  // reads exactly like genuinely zero clients.
  // The flags below separate three facts: the first page never arrived (error,
  // nothing to show), the list is incomplete (a later page failed, or the eager
  // page walk in usePairedList is still running), and the list is complete.
  // A count is only printed for a complete list; an unknown count is never "0".
  // "Nothing to show" includes an EMPTY cached list under a failed refetch
  // (TQ v5 keeps the empty page): emptiness is unconfirmed, so it is the
  // error with retry, not the "pair your first client" state.
  const pairsListUnknown =
    pairsQuery.isError && (pairsQuery.data === undefined || pairs.length === 0);
  const pairsNextPageFailed = pairsQuery.isFetchNextPageError;
  const pairsCountKnown =
    !pairsLoading &&
    pairsQuery.data !== undefined &&
    !pairsListUnknown &&
    !pairsQuery.hasNextPage &&
    !pairsNextPageFailed;
  // DECISION (nie usuwaj tego komentarza) — owner 2026-10-08: the greeting is
  // „Witaj z powrotem, {imię}”, FIRST NAME ONLY. The salon's display name
  // (often two or three words) wrapped the title to two lines and pushed the
  // screen down; it used to win here as "the brand voice". Order: first name
  // from the session, then from the account query (the session hook can stall
  // in a cookie-less WebView), then the first word of the display name, then
  // the e-mail local part, so the greeting never ends in a bare comma.
  const { data: currentUser } = useCurrentUserAccount();
  const firstName =
    displayName ||
    (currentUser?.name?.split(' ')[0] ??
      currentUser?.stylist_account?.display_name?.split(' ')[0] ??
      (currentUser?.email ? currentUser.email.split('@')[0] : '')) ||
    '';

  // DASH-1/6: activation progress is a hook, so it must run before the early
  // returns (rules of hooks). Counts default to 0 while the feed is loading.
  const photoCount = feed?.photo_count ?? 0;
  const pairedClientCount = feed?.paired_client_count ?? 0;
  const pendingShares = feed?.pending_shares_count ?? 0;
  const activation = useActivationProgress({
    photoCount,
    pinnedCount: feed?.pinned_count ?? 0,
    pairedClientCount,
    pendingSharesCount: pendingShares,
    accountId: currentUser?.id,
  });
  // Hak MUSI stać przed wczesnymi zwrotami niżej (kolejność haków).
  const { dismiss: dismissGalleryStrength } = useDismissGalleryStrength();

  if (isLoading) {
    return <StylistDashboardSkeleton />;
  }

  // Full-screen error only when there is NOTHING to show. A failed background
  // refetch keeps the cached feed (TQ v5: isError with data = stale data), so
  // the stylist keeps her dashboard instead of losing it to a flaky network.
  if (isError && feed === null) {
    return (
      <div className={pageStyles.page}>
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={tButtons('retry')}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  const galleryStrengthScore = feed?.gallery_strength_score ?? 25;
  const strengthProps = {
    photoCount,
    hasProfileBio: galleryStrengthScore > 30,
    hasProfilePhoto: galleryStrengthScore > 35,
    hasSpecialization: galleryStrengthScore > 50,
    pairedClientCount,
  };
  // Same formula the card uses (DECISION przy `isDismissed` w komponencie):
  // at 100% the card would only say „done”, so the dashboard states it in one
  // line of the reading column and the card shows only while it has tasks.
  const strengthComplete =
    calculateStrength(strengthProps) >= MAX_STRENGTH_SCORE;
  const strengthDismissed = feed?.gallery_strength_dismissed ?? false;
  const recentBookmarks = feed?.recent_bookmarks_count ?? 0;
  const hasPhotos = photoCount > 0;
  const stage = photoCount < WORKS_BEFORE_SHOWING_CODE ? 'addWork' : 'showCode';
  // No clients yet: the empty state of the clients section carries „show your
  // code”. At the showCode stage that IS the main action, so it is filled
  // there and not repeated as a second button above.
  const clientsEmpty = !pairsLoading && !pairsListUnknown && pairs.length === 0;
  const mainActionInEmptyState = stage === 'showCode' && clientsEmpty;

  // S26 census: hero niesie ŻYWE DANE (meta), nie marketing-subtitle.
  // Człon klientek dopiero gdy lista jest KOMPLETNA — w locie / po błędzie
  // zniknięty człon > kłamliwe "brak połączonych klientek" albo zaniżona liczba.
  const heroMeta = (
    <>
      <span>{t('heroMetaWorks', { count: photoCount })}</span>
      {pairsCountKnown && (
        <span>{t('heroMetaClients', { count: pairs.length })}</span>
      )}
    </>
  );
  // „Witaj z powrotem" na PIERWSZEJ wizycie jest nieprawdą: stylistka trafia
  // tu prosto z onboardingu (flow-pass S123). Rozstrzyga liczba prac: kto ma
  // zdjęcia, był tu na pewno, a przy pustym portfolio „Witaj" jest prawdziwe
  // w obu odczytach. Licznik jest autorytatywny (wczesny return na isLoading).
  const greeting = hasPhotos ? t('welcomeBack') : t('welcomeFirst');

  const main = (
    <>
      <StylistWaitingListMolecule
        pendingShares={pendingShares}
        unreadMessages={unreadMessages}
      />

      {!mainActionInEmptyState && (
        <div className={pageStyles.mainAction}>
          {stage === 'addWork' ? (
            <ButtonAtom
              variant='primary'
              size='lg'
              icon={<PlusIcon size={18} weight='bold' />}
              className='haptic-press'
              onClick={() =>
                void router.push(ROUTES_FRONT.GALLERY_UPLOAD_ASSET)
              }>
              {t('mainAction.addWork')}
            </ButtonAtom>
          ) : (
            <ButtonAtom
              variant='primary'
              size='lg'
              direction='forward'
              className='haptic-press'
              onClick={() => void router.push(ROUTES_FRONT.PAIRING)}>
              {t('mainAction.showCode')}
            </ButtonAtom>
          )}
        </div>
      )}

      <PairedClientsWidgetOrganism
        pairs={pairs}
        isLoading={pairsLoading}
        loadFailed={pairsListUnknown}
        moreFailed={pairsNextPageFailed}
        onRetry={() => void pairsQuery.refetch()}
        isRetrying={pairsQuery.isFetching}
        onRetryMore={() => void pairsQuery.fetchNextPage()}
        isRetryingMore={pairsQuery.isFetchingNextPage}
        totalKnown={pairsCountKnown}
        attention={stripAttention}
        emptyActionVariant={mainActionInEmptyState ? 'primary' : 'outlined'}
      />

      {/* Shortcuts: messages live here while nothing is unread (with unread
          they are in the waiting list above), plus the likes nudge (N3). */}
      {(unreadMessages < 1 || recentBookmarks > 0) && (
        <NavRowListMolecule ariaLabel={t('shortcutsLabel')}>
          {unreadMessages < 1 && (
            <StylistMessagesRowMolecule unreadMessages={0} />
          )}
          {recentBookmarks > 0 && (
            <NavRowMolecule
              href={ROUTES_FRONT.GALLERY}
              icon={<HeartIcon />}
              label={t('likesTitle', { count: recentBookmarks })}
              description={t('likesHint')}
              trailing='disc'
            />
          )}
        </NavRowListMolecule>
      )}

      {/* DASH-1/6: the activation checklist owns the journey until every
          milestone is reached (high-water latched); gallery strength takes
          over afterwards, so the two progress systems never compete. */}
      {!activation.isComplete ? (
        <ActivationChecklistOrganism
          progress={activation}
          trialEndsAt={resolveTrialBannerEndsAt(currentUser?.stylist_account)}
        />
      ) : (
        !strengthComplete && <GalleryStrengthOrganism {...strengthProps} />
      )}
    </>
  );

  return (
    <div className={pageStyles.page}>
      <AppHeroOrganism
        title={firstName ? `${greeting},` : `${greeting}.`}
        {...(firstName ? { accentInline: firstName } : {})}
        meta={heroMeta}
      />
      <PageColumnsMolecule
        main={main}
        aside={
          <StylistDashboardAsideOrganism
            feed={feed}
            strengthDone={
              activation.isComplete && strengthComplete && !strengthDismissed
            }
            onDismissStrength={dismissGalleryStrength}
            roleZone={roleZone}
          />
        }
      />
    </div>
  );
}
