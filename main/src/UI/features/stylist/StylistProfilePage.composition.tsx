import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import posthog from 'posthog-js';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { incrementProfileView_IO } from '../../../domain/account/accountIO.possibilities.api';
import { profileQueryOptions } from './StylistProfilePage.query';
import { isProfileNotFoundError } from './_profile-error.helpers';
import type { StylistProfileData } from './_jsonld.helpers';
import { useCurrentUser } from '../../contexts/AuthContext.composition';
import { useIsClient } from '../../shared/hooks/useSessionRole';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { useProfileBookmarkState } from './hooks/useProfileBookmarkState';
import { usePairingAccessStatus } from '../shared/pairing/hooks/usePairingAccessStatus';
import { useRequestPair } from '../shared/pairing/hooks/usePairRequests';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { StylistProfileActionsOrganism } from './StylistProfileActions.organism';
import { StylistProfileGalleryOrganism } from './StylistProfileGallery.organism';
import { StylistProfileHeaderOrganism } from './StylistProfileHeader.organism';
import { StylistProfilePageSkeletonMolecule } from './StylistProfilePageSkeleton.molecule';
import { StylistProfileEmptyStateMolecule as EmptyState } from './StylistProfileEmptyState.molecule';
import { StylistProfileStatsMolecule } from './StylistProfileStats.molecule';
import { StylistProfileContactMolecule } from './StylistProfileContact.molecule';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import styles from './StylistProfilePage.module.css';

/* ─── Types ─── */

interface StylistProfilePageProps {
  identifier: string;
  initialProfile?: StylistProfileData | null;
  /** Telefon stylistki zakodowany PII (server-side); null gdy nie podano. */
  encodedPhone?: string | null;
}

/* ─── Query options — wydzielone do StylistProfilePage.query.ts (S76) ─── */

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

  /* ─── Auth + bookmark state ─── */
  // isLoading gate (Codex #8): przed hydration auth `user` jest null i CTA
  // renderowałoby wariant gościa (klik → zbędny bounce na login) — prośbę
  // pokazujemy dopiero po rozstrzygnięciu sesji.
  const { user, isLoading: authLoading } = useCurrentUser();
  // Bookmarking a stylist is CLIENT-only (BOOKMARK_STYLIST). A stylist-mode
  // session gets share/pair instead — showing them the bookmark CTA only leads
  // to a 403. Gate the CTA (and the underlying query) on client mode.
  const canBookmark = useIsClient();
  // S76: user bez konta roli (porzucony onboarding) ma w sesji accountType
  // CLIENT bez client_account w DB → client-only endpointy 403 + mylący toast
  // "Zaloguj się". Queries wymagają POTWIERDZONEGO client_account; akcje
  // kierują na /app (onboarding-guard dokończy setup).
  const { data: currentAccount } = useCurrentUserAccount();
  // S82: undefined = query CURRENT_USER jeszcze w locie (osobny round-trip po
  // rozstrzygnięciu sesji BA) — w tym oknie NIE wiemy, czy user ma konto roli;
  // akcje są no-op do rozstrzygnięcia (klik w ~1s okno nie może bounce'ować
  // realnej klientki na /app jak roleless).
  const accountResolved = currentAccount !== undefined;
  const hasClientAccount = currentAccount?.client_account != null;
  // Zakładka (query strony 1 + mutacje + knownBookmarked-sync) —
  // useProfileBookmarkState (S82, wydzielone pod max-lines).
  const bookmark = useProfileBookmarkState({
    identifier,
    stylistAccountId: profileQuery.data?.account.account_id ?? null,
    hasClientAccount,
  });

  /* ─── Pairing state (stały kod QR, 2026-07-11) ─── */
  // Realny stan pary z access-status (token-gated: logged-out ruch nie strzela).
  // Do ACTIONS idzie realny stan (badge Połączono + galeria + „prośba wysłana"
  // to działające linki/etykiety); do HEADERA celowo dalej `false` — jego menu
  // unpair na public route nie woła backendu (realny unpair żyje w /app;
  // MIG-B3 unifikuje). Prośba o połączenie: client-only endpoint, więc CTA
  // widzi klientka i (jako droga do logowania) gość.
  const accountIdForStatus = profileQuery.data?.account.account_id ?? '';
  const {
    isPaired,
    isPendingRequest,
    pairId,
    isChecked: accessChecked,
    checkFailed: accessCheckFailed,
    isFetching: isFetchingAccess,
    refetch: refetchAccess,
  } = usePairingAccessStatus(
    accountIdForStatus,
    user != null &&
      canBookmark &&
      hasClientAccount &&
      accountIdForStatus.length > 0
  );
  const requestPairMutation = useRequestPair();

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

  // Lejek stałego QR: wejście z ?from=qr = skan plakatu/wizytówki — zliczane
  // RAZ per profil (ref jak viewFiredRef; posthog respektuje opt-out).
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
    posthog.capture('stylist_profile_qr_scan', {
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
    // DECISION (nie usuwaj tego komentarza):
    // Publiczny profil NIE woła backendu unpair celowo — realny unpair żyje
    // WYŁĄCZNIE na uwierzytelnionych trasach /app (hook useUnpair →
    // PAIRING_ACCESS_REVOKE). Dialog jest tu NIEOSIĄGALNY (HEADER dostaje
    // isPaired=false na public route — patrz komentarz przy access-status).
    // Header/Actions mają JEDNEGO konsumenta (tę stronę), więc plumbing
    // dialogu nie jest współdzielony — zostaje wyłącznie jako scaffold
    // MIG-B3 (unifikacja unpair na public route), z tym no-opem jako
    // miejscem na useUnpair. Feedback „rozłączono" bez wywołania backendu jest
    // częścią scaffoldu, nie żywym flow. (TQM B17: świadomie NIE wiremy
    // useUnpair tutaj.)
    setUnpairDialogOpen(false);
    setUnpairConfirmText('');
    setFeedbackMessage(tFeedback('unpaired'));
  };

  const handleToggleBookmark = () => {
    if (!profile || !user || !accountResolved) {
      return;
    }
    if (!hasClientAccount) {
      // Porzucony onboarding → dokończ setup zamiast 403 (guard na /app).
      void router.push(ROUTES_FRONT.APP);
      return;
    }
    bookmark.toggle();
  };

  const handleRequestPair = () => {
    if (!profile) {
      return;
    }
    if (!user) {
      // Gość: prośba wymaga konta klientki — login z powrotem na TEN profil
      // (kontrakt `?from=` — parytet z buildPlanLoginHref).
      void router.push(
        `${ROUTES_FRONT.USER_LOG}?from=${encodeURIComponent(router.asPath)}`
      );
      return;
    }
    if (!accountResolved) {
      // Okno ładowania CURRENT_USER (S82): nie wiemy jeszcze, czy user ma
      // konto roli — klik no-op zamiast błędnego bounce'a na /app.
      return;
    }
    if (!hasClientAccount) {
      // S76: roleless → dokończ setup zamiast doomed-403 (guard na /app).
      void router.push(ROUTES_FRONT.APP);
      return;
    }
    requestPairMutation.mutate(
      { stylist_account_id: profile.account.account_id },
      {
        onSuccess: data => {
          if (data.status === 'PENDING') {
            // Licznik lejka tylko przy REALNYM utworzeniu (created) —
            // idempotentny re-POST nie pompuje funnela (Codex #9).
            if (data.created) {
              // pair_id = wspólny klucz z pair_request_accepted/declined
              // (join lejka między KLIENTKĄ a STYLISTKĄ — Codex S51).
              posthog.capture('pair_request_sent', {
                stylist_account_id: profile.account.account_id,
                pair_id: data.pair_id,
              });
            }
            setFeedbackMessage(tFeedback('pairRequestSent'));
          } else {
            // ALREADY_PAIRED — access-status invaliduje się i UI przejdzie
            // na widok połączony; feedback tłumaczy brak zmiany przycisku.
            setFeedbackMessage(tFeedback('pairRequestAlreadyPaired'));
          }
        },
        // DECISION (nie usuwaj tego komentarza): ZERO lokalnego onError-feedbacku.
        // useRequestPair ma suppressGlobalError (warstwa 3), ale błąd prośby
        // toastuje warstwa 1 (HTTP interceptor) — pairRequestCreate nie ustawia
        // silentBusinessError, więc backendowy event (np. PAIRING_LIMIT_REACHED)
        // pokaże się jako snackbar. Inline banner błędu = DRUGI, generyczny
        // komunikat tego samego błędu (redundant feedback, S74). Sukces zostaje
        // inline banner, bo eventy PAIR_REQUEST_SENT/ALREADY_PAIRED są w
        // eventsDisallowedForUI (interceptor milczy). Kontrakt: queryClient.config.ts.
      }
    );
  };

  /* ─── Render guards ─── */

  if (profileQuery.isLoading) {
    return <StylistProfilePageSkeletonMolecule />;
  }

  // 5xx / brak sieci ≠ „nie znaleziono": profil może istnieć, więc mówimy
  // o błędzie i dajemy ponowienie zamiast wysyłać usera na stronę główną.
  // Odwrotnie też: 404 (martwy link z QR/wizytówki) to „nie znaleziono", nie
  // „spróbuj ponownie" — ponowienie nigdy by się nie udało.
  if (
    profileQuery.isError &&
    !profile &&
    !isProfileNotFoundError(profileQuery.error)
  ) {
    return (
      <EmptyState
        title={tProfile('loadError.title')}
        description={tProfile('loadError.description')}
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
    encodedPhone,
    pairId,
    canRequestPair:
      !authLoading &&
      (user == null || canBookmark) &&
      accessChecked &&
      !accessCheckFailed,
    isRequestingPair: requestPairMutation.isPending,
    isBookmarked: bookmark.isBookmarked,
    isBookmarkPending: bookmark.isPending,
    canBookmark,
    unpairDialogOpen,
    unpairConfirmText,
    onToggleBookmark: handleToggleBookmark,
    onRequestPair: handleRequestPair,
    onUnpairDialogOpenChange: handleCloseUnpairDialog,
    onUnpairConfirmTextChange: setUnpairConfirmText,
    onConfirmUnpair: handleConfirmUnpair,
  };

  // DECISION (nie usuwaj tego komentarza) — głos ownera `s126-profil`,
  // 2026-10-09: „DZIŚ, ale weź sekcję KONTAKT z wersji A”. Ten układ (nagłówek
  // z awatarem, prace, opis, kontakt, akcje, lista korzyści w kolumnie 720 px)
  // wygrał z trzema kandydatami i jest jedynym wyglądem profilu publicznego;
  // maszt typograficzny (A), mozaika z belką akcji (B) oraz szyna i ściana (C)
  // zostały usunięte. Z A weszła wyłącznie sekcja „Kontakt”.
  // KONTAKT stoi po opisie, a przed akcjami, czyli w miejscu dawnej karty
  // telefonu: prace zostają pierwsze (DECISION niżej), odwiedzająca czyta
  // „co robi” i „kim jest”, potem „jak się z nią skontaktować”, a zaraz pod
  // tym ma główną akcję strony (prośbę o połączenie).
  return (
    <div className={styles.page}>
      {/* HEADER celowo z isPaired=false: jego menu „rozłącz" nie woła backendu
          na public route (patrz DECISION w handleConfirmUnpair) — pokazanie go
          sparowanej klientce byłoby martwym przyciskiem. Realny stan pary
          niesie ACTIONS (badge/galeria/prośba = działające elementy). */}
      <StylistProfileHeaderOrganism
        account={account}
        isPaired={false}
        onUnpairRequest={handleOpenUnpairDialog}
      />

      <StylistProfileStatsMolecule
        bookmarkCount={profile.bookmark_count}
        totalLikes={profile.total_likes}
        galleryCount={profile.gallery_records_count}
        viewCount={account.view_count}
      />

      {/* DECISION (nie usuwaj) — owner 2026-09-17: prace stoją NAD opisem,
          telefonem i akcjami („muszą być od razu widoczne”). Nie odwracać. */}
      <StylistProfileGalleryOrganism
        accountId={account.account_id}
        galleryRecordsCount={profile.gallery_records_count}
      />

      {account.description && (
        <section className={`${styles.section} ${styles.bioSection}`}>
          <TypographyAtom variant='body1'>{account.description}</TypographyAtom>
        </section>
      )}

      <StylistProfileContactMolecule
        encodedPhone={encodedPhone ?? null}
        website={account.website}
        instagramHandle={account.instagram_handle}
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

      {/* Inline feedback banner — visual confirmation directly on profile actions
          (favorite/copy-link). Snackbar (pushNewSnackbar) covers global notifications. */}
      {feedbackMessage && (
        <div role='status' aria-live='polite' className={styles.feedbackBanner}>
          {feedbackMessage}
        </div>
      )}
    </div>
  );
}

export function StylistProfilePageComposition(props: StylistProfilePageProps) {
  return (
    <PublicLayoutComposition>
      <StylistProfilePageInner {...props} />
    </PublicLayoutComposition>
  );
}
