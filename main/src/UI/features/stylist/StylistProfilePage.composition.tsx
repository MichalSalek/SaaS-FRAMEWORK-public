import { usePairingOutcome } from '../shared/pairing/usePairingOutcome';
import { brandScopeProps } from '../shared/branding/brandScope';
import { OutcomeStateMolecule } from '../../components/OutcomeFeedback/OutcomeState.molecule';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { capturePosthog } from '../../../application/analytics/posthog-client';
import { incrementProfileView_IO } from '../../../domain/account/accountIO.possibilities.api';
import { profileQueryOptions } from './StylistProfilePage.query';
import { isProfileNotFoundError } from './_profile-error.helpers';
import type { StylistProfileData } from './_jsonld.helpers';
import { useCurrentUser } from '../../contexts/AuthContext.composition';
import { useIsClient } from '../../shared/hooks/useSessionRole';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { useProfileBookmarkState } from './hooks/useProfileBookmarkState';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { StylistProfileActionsOrganism } from './StylistProfileActions.organism';
import { StylistProfileGalleryOrganism } from './StylistProfileGallery.organism';
import { StylistProfileHeaderOrganism } from './StylistProfileHeader.organism';
import { StylistProfilePageSkeletonMolecule } from './StylistProfilePageSkeleton.molecule';
import { StylistProfileEmptyStateMolecule as EmptyState } from './StylistProfileEmptyState.molecule';
import { StylistProfileStatsMolecule } from './StylistProfileStats.molecule';
import { StylistProfileContactMolecule } from './StylistProfileContact.molecule';
import { StylistPublicLayoutComposition } from '../../layouts/StylistPublicLayout.composition';
import styles from './StylistProfilePage.module.css';
import * as pairHelpers from './_client-onboarding.helpers';
import { useProfilePairRequest } from './hooks/useProfilePairRequest';
import { useProfileContactIntent } from './hooks/useProfileContactIntent';

/* ─── Types ─── */

interface StylistProfilePageProps {
  identifier: string;
  initialProfile?: StylistProfileData | null;
  /** The stylist's phone, PII-encoded (server-side); null when not given. */
  encodedPhone?: string | null;
}

/* ─── Query options: extracted to StylistProfilePage.query.ts ─── */

/* ─── Main page component ─── */

function StylistProfilePageInner({
  identifier,
  initialProfile,
  encodedPhone,
}: StylistProfilePageProps) {
  const router = useRouter();
  const tProfile = useTranslations('stylist.profile');
  const tFeedback = useTranslations('stylist.feedback');
  const tButtons = useTranslations('buttons');

  /* ─── Server state ─── */
  const profileQuery = useQuery(
    profileQueryOptions(identifier, initialProfile)
  );
  const profile = profileQuery.data;
  const pairingOutcome = usePairingOutcome(profile?.account.account_id);

  /* ─── Auth + bookmark state ─── */
  // isLoading gate: before auth hydration `user` is null and the CTA
  // would render the guest variant (a click → a needless bounce to login); the request
  // is shown only once the session is resolved.
  const { user } = useCurrentUser();
  // Bookmarking a stylist is CLIENT-only (BOOKMARK_STYLIST). A stylist-mode
  // session uses its own role actions; showing the bookmark CTA only leads
  // to a 403. Gate the CTA (and the underlying query) on client mode.
  const isClientMode = useIsClient();
  // A user with no role account (abandoned onboarding) has accountType
  // CLIENT in the session with no client_account in the DB → client-only endpoints 403 + a misleading toast
  // "Zaloguj się". Queries require a CONFIRMED client_account; actions
  // route to /app (the onboarding guard finishes the setup).
  const { data: currentAccount } = useCurrentUserAccount();
  // undefined = the CURRENT_USER query is still in flight (a separate round trip after
  // the BA session resolves): in this window we do NOT know whether the user has a role account;
  // actions are no-ops until resolved (a click in the ~1s window must not bounce
  // a real client to /app as roleless).
  const accountResolved = currentAccount !== undefined;
  const hasClientAccount = currentAccount?.client_account != null;
  const canBookmark =
    isClientMode &&
    hasClientAccount &&
    currentAccount?.stylist_account?.account_id !== profile?.account.account_id;
  // The bookmark (page-1 query + mutations + knownBookmarked sync) lives in
  // useProfileBookmarkState (extracted for max-lines).
  const bookmark = useProfileBookmarkState({
    identifier,
    stylistAccountId: profileQuery.data?.account.account_id ?? null,
    hasClientAccount,
  });

  /* ─── Pairing state (permanent QR code) ─── */
  // The real pair state from access-status (token-gated: logged-out traffic does not fire).
  // ACTIONS gets the real state (the Połączono badge + gallery + „prośba wysłana"
  // are working links/labels); the HEADER deliberately still gets `false`: its unpair
  // menu on a public route does not call the backend (the real unpair lives in /app).
  // A connection request is a client-only endpoint, so the CTA is
  // seen by a client and (as a way to log in) a guest.
  const pairRequest = useProfilePairRequest(profile, pairingOutcome.confirm);
  const contact = useProfileContactIntent(profile?.account.account_id ?? '');
  const {
    pairId,
    checkFailed: accessCheckFailed,
    isFetching: isFetchingAccess,
    refetch: refetchAccess,
  } = pairRequest.access;
  const isPaired = pairRequest.audience === 'clientPaired';
  const isPendingRequest = pairRequest.audience === 'clientPending';

  /* ─── UI state ─── */
  const [unpairDialogOpen, setUnpairDialogOpen] = useState(false);
  const [unpairConfirmText, setUnpairConfirmText] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  // Fire-and-forget profile view increment — once per identifier, after data loads.
  // ref prevents double-fire on StrictMode double-effect / re-renders.
  const viewFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!profile) {
      return;
    }
    const accountId = profile.account.account_id;
    if (viewFiredRef.current === accountId) {
      return;
    }
    viewFiredRef.current = accountId;
    // Raw IO (outside TanStack) — suppressGlobalError does not apply, so swallow
    // failures explicitly. View counting is non-critical; a 4xx/5xx/timeout
    // must not surface an unhandled rejection.
    void incrementProfileView_IO({ stylist_account_id: accountId }).catch(
      () => {}
    );
  }, [profile]);

  useEffect(() => {
    setUnpairDialogOpen(false);
    setUnpairConfirmText('');
    setFeedbackMessage(null);
  }, [identifier]);

  // Permanent-QR funnel: an entry with ?from=qr = a poster/business-card scan, counted
  // ONCE per profile (a ref like viewFiredRef; posthog respects opt-out).
  const qrScanFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!profile || router.query.from !== 'qr') {
      return;
    }
    const accountId = profile.account.account_id;
    if (qrScanFiredRef.current === accountId) {
      return;
    }
    qrScanFiredRef.current = accountId;
    capturePosthog('stylist_profile_qr_scan', {
      stylist_account_id: accountId,
    });
  }, [profile, router.query.from]);

  // Auto-dismiss feedback toast-like banner
  useEffect(() => {
    if (!feedbackMessage) {
      return;
    }
    const t = window.setTimeout(() => setFeedbackMessage(null), 3000);
    return () => window.clearTimeout(t);
  }, [feedbackMessage]);

  const handleOpenUnpairDialog = () => {
    setUnpairDialogOpen(true);
  };

  const handleCloseUnpairDialog = (open: boolean) => {
    if (!open) {
      setUnpairDialogOpen(false);
      setUnpairConfirmText('');
    }
  };

  const handleConfirmUnpair = () => {
    // DECISION: the public profile deliberately never calls the unpair backend; real unpair
    // lives only on authenticated /app routes (useUnpair → PAIRING_ACCESS_REVOKE). This
    // dialog is unreachable because the header gets isPaired=false here; the plumbing stays
    // as the slot for a future public-route unpair. Do not wire useUnpair in here.
    setUnpairDialogOpen(false);
    setUnpairConfirmText('');
    setFeedbackMessage(tFeedback('unpaired'));
  };

  const handleToggleBookmark = () => {
    if (!profile || !user || !accountResolved) {
      return;
    }
    if (!hasClientAccount) {
      // Abandoned onboarding → finish the setup instead of a 403.
      void router.push(pairHelpers.clientOnboardingHref(router.asPath));
      return;
    }
    bookmark.toggle();
  };

  /* ─── Render guards ─── */

  if (profileQuery.isLoading) {
    return <StylistProfilePageSkeletonMolecule />;
  }

  // 5xx / no network ≠ „not found": the profile may exist, so we report
  // an error and offer a retry instead of sending the user to the home page.
  // The reverse too: 404 (a dead QR/business-card link) is „not found", not
  // „try again": a retry would never succeed.
  if (
    profileQuery.isError &&
    !profile &&
    !isProfileNotFoundError(profileQuery.error)
  ) {
    return (
      <EmptyState
        title={tProfile('loadError.title')}
        action={
          <ButtonAtom
            variant='outlined'
            size='md'
            onClick={() => void profileQuery.refetch()}
            disabled={profileQuery.isFetching}
            aria-busy={profileQuery.isFetching}>
            {tButtons('retry')}
          </ButtonAtom>
        }
      />
    );
  }

  if (!profile) {
    return (
      <EmptyState
        title={tProfile('notFound.title')}
        description={tProfile('notFound.description')}
      />
    );
  }

  const { account } = profile;

  const actions = {
    account,
    isPaired,
    isPendingRequest,
    audience: pairRequest.audience,
    encodedPhone,
    pairId,
    canRequestPair: pairRequest.canRequestPair,
    isRequestingPair: pairRequest.isPending,
    isBookmarked: bookmark.isBookmarked,
    isBookmarkPending: bookmark.isPending,
    canBookmark,
    unpairDialogOpen,
    unpairConfirmText,
    onToggleBookmark: handleToggleBookmark,
    onRequestPair: pairRequest.request,
    onContact: contact.request,
    contactPending: contact.isPending,
    contactFailed: contact.failed,
    onUnpairDialogOpenChange: handleCloseUnpairDialog,
    onUnpairConfirmTextChange: setUnpairConfirmText,
    onConfirmUnpair: handleConfirmUnpair,
  };

  // DECISION: the description sits in the white hero, under the name, with no
  // heading. Works stay above contact and the pairing action (owner).
  return (
    <div {...brandScopeProps(account.brand_accent_color, styles.page)}>
      {/* HEADER deliberately with isPaired=false: its „rozłącz" menu does not
          call the backend on a public route (see the DECISION in
          handleConfirmUnpair), so showing it to a paired client would be a dead
          button. ACTIONS carries the real pair state (badge/gallery/request are
          the working elements). */}
      <StylistProfileHeaderOrganism
        account={account}
        salonLink={profile.salon_link ?? null}
        isPaired={false}
        isPendingRequest={isPendingRequest}
        onUnpairRequest={handleOpenUnpairDialog}
      />

      <StylistProfileStatsMolecule
        bookmarkCount={profile.bookmark_count}
        totalLikes={profile.total_likes}
        galleryCount={profile.gallery_records_count}
        viewCount={account.view_count}
      />

      {/* DECISION: the works stand above contact and the pairing action (owner). */}
      <StylistProfileGalleryOrganism
        accountId={account.account_id}
        galleryRecordsCount={profile.gallery_records_count}
      />

      {/* A failed pairing check is not „not paired": without an answer the
          request CTA would invite an already paired client to pair again. */}
      {accessCheckFailed && (
        <ErrorStateMolecule
          message={tProfile('pairingStatusError')}
          retryLabel={tButtons('retry')}
          onRetry={() => void refetchAccess()}
          isRetrying={isFetchingAccess}
        />
      )}

      <StylistProfileActionsOrganism {...actions} />

      <StylistProfileContactMolecule
        encodedPhone={encodedPhone ?? null}
        website={account.website}
        instagramHandle={account.instagram_handle}
        externalLinks={account.external_links ?? []}
      />

      {/* Inline feedback banner — visual confirmation directly on profile actions
          (favorite/copy-link). Snackbar (pushNewSnackbar) covers global notifications. */}
      {pairRequest.dialog}
      {pairingOutcome.feedback(pairRequest.audience)}
      {feedbackMessage && (
        <OutcomeStateMolecule
          confirmed
          message={feedbackMessage}
          marked={false}
          className={styles.feedbackBanner}
        />
      )}
    </div>
  );
}

export function StylistProfilePageComposition(props: StylistProfilePageProps) {
  return (
    <StylistPublicLayoutComposition>
      <StylistProfilePageInner {...props} />
    </StylistPublicLayoutComposition>
  );
}
