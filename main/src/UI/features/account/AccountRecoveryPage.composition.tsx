// UI/features/account/AccountRecoveryPage.tsx
// ADRR Model A (§13.1) — post-login, state-driven account recovery screen.
//
// State is computed CLIENT-SIDE from the current user (GET /session/get-current
// → SafeCurrentUser) via deriveAccountRecoveryState — NOT an email check (the
// legacy check-recovery flow is retired; recovery is post-login + zero
// enumeration). Three states (§13.1):
//   - RECOVERABLE → status + days-left countdown + 1-click "Przywróć konto"
//     (useReactivateAccount → POST /user/reactivate). On success the query
//     invalidates, state recomputes to ACTIVE and the app shell releases.
//   - EXPIRED → "okno recovery minęło" + GDPR Art. 17 permanent-delete
//     (useGdprErase → POST /user/gdpr-erase, then sign-out + redirect HOME).
//   - ACTIVE → account is healthy; defensive hub with a link back to the app
//     (users normally never land here — the AppLayout guard only routes
//     soft-deleted users to this page).
//
// Every state has ONE action. The wait is a skeleton (RecoveryCheckingOrganism),
// a failed read is the shared ErrorStateMolecule with a retry.
// Stack: TQ v5 + CSS Modules + Phosphor Icons.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { hasSessionToken } from '../../shared/hooks/currentUser.query';
import { pushNewSnackbar } from '../../../application/app-snackbar/appSnackbar.possibilities.api';
import {
  deriveAccountRecoveryState,
  getRecoveryDaysLeft,
} from './helpers/account-recovery-state.helper';
import { useReactivateAccount } from './hooks/useReactivateAccount';
import { useGdprErase } from './hooks/useGdprErase';
import {
  RecoveryCheckingOrganism,
  RecoveryNoticeOrganism,
} from './AccountRecoveryStates.organism';
import {
  ExpiredViewOrganism,
  RecoverableViewOrganism,
} from './AccountRecoveryPage.flows.organism';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import styles from './AccountRecoveryPage.module.css';

/* ─── Main component ─── */

function AccountRecoveryPageInner() {
  const t = useTranslations('account.recovery');
  const router = useRouter();

  const {
    data: currentUser,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useCurrentUserAccount();
  const reactivateMutation = useReactivateAccount();
  const gdprMutation = useGdprErase();

  const [isRecoverDialogOpen, setIsRecoverDialogOpen] = useState(false);
  const [isGdprDialogOpen, setIsGdprDialogOpen] = useState(false);

  // DECISION (nie usuwaj — hydration fix, parytet z AccountPage S45): konto jest
  // auth-gated (Bearer token w localStorage), a SSR nie zna sesji → useCurrentUserAccount
  // disabled na serwerze (isLoading=false → branch recoveryState z currentUser=undefined),
  // a pierwszy client-render ma token (isLoading=true → CheckingState). Server renderuje
  // widok stanu, klient CheckingState = "server HTML didn't match client". Mount-gate:
  // SSR i first-CSR renderują identyczny CheckingState, treść dopiero po zamontowaniu.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const recoveryState = deriveAccountRecoveryState(currentUser);
  const daysLeft = getRecoveryDaysLeft(currentUser?.deleted_at);

  const restoreItems: readonly string[] = [
    t('restorePhotos'),
    t('restorePairings'),
    t('restoreProfile'),
    t('restoreHistory'),
  ];

  /* ─── Handlers ─── */

  const handleGoToDashboard = () => {
    void router.push(ROUTES_FRONT.APP);
  };

  const handleConfirmRecover = () => {
    reactivateMutation.mutate(undefined, {
      onSuccess: () => {
        setIsRecoverDialogOpen(false);
        // Query invalidation flips state to ACTIVE; show success affordance.
        pushNewSnackbar(APP_EVENTS.INFO.USER.ACCOUNT_REACTIVATED, 'success');
      },
      onError: () => {
        setIsRecoverDialogOpen(false);
        // DECISION (nie usuwaj): error toast należy do HTTP interceptora
        // (event-bus Stage 1 — ACCOUNT_REACTIVATION_FAILED na 409,
        // INTERNET_CONNECTION_PROBLEM na sieci). Lokalny push tu duplikował go
        // (inny event na ścieżce sieciowej → brak dedup → double-toast).
        // Refetch ZOSTAJE: okno recovery mogło właśnie minąć (race z cronem),
        // re-read stanu przełącza widok na EXPIRED.
        void refetch();
      },
    });
  };

  const handleConfirmErase = () => {
    gdprMutation.mutate(undefined, {
      onSuccess: () => {
        setIsGdprDialogOpen(false);
        // Hook signs out + redirects HOME; snackbar may not be seen but is set
        // for the brief interval before navigation.
        pushNewSnackbar(APP_EVENTS.INFO.USER.ACCOUNT_GDPR_ERASED, 'success');
      },
      onError: () => {
        setIsGdprDialogOpen(false);
        // DECISION (nie usuwaj): error toast należy do HTTP interceptora
        // (event-bus Stage 1 — backendowy event błędu, lub
        // INTERNET_CONNECTION_PROBLEM na sieci). Lokalny push GENERAL_ERROR
        // duplikował go (inny event key / brak dedup na ścieżce sieciowej).
      },
    });
  };

  const handleBackToLogin = () => {
    void router.push(ROUTES_FRONT.USER_LOG);
  };

  /* ─── Transient states ─── */

  if (!mounted || isLoading) {
    return (
      <div className={styles.page}>
        <RecoveryCheckingOrganism />
      </div>
    );
  }

  /* ─── LOGGED OUT — no session token (e.g. the login-screen "restore closed
   * account" link) ─── */
  // Recovery is post-login + state-driven (zero enumeration): with no token the
  // account query is disabled, so currentUser is undefined and the derived state
  // would default to ACTIVE — falsely telling a logged-out visitor their account
  // is healthy (and offering a dashboard CTA that just bounces at the guard).
  // Prompt a sign-in instead. Read AFTER the mount gate so SSR/first-CSR stay
  // hydration-identical (both render CheckingState until `mounted`).
  if (!hasSessionToken()) {
    return (
      <div className={styles.page}>
        <AppHeroOrganism title={t('heroLoggedOutTitle')} />
        <RecoveryNoticeOrganism
          body={t('statusLoggedOutBody')}
          action={
            <ButtonAtom
              direction='forward'
              variant='primary'
              size='lg'
              onClick={handleBackToLogin}
              className='haptic-press'>
              {t('goToLogin')}
            </ButtonAtom>
          }
        />
      </div>
    );
  }

  // Błąd tylko bez danych: nieudane odświeżenie w tle (np. refetch po
  // nieudanym przywróceniu) zostawia w cache ostatni stan konta, który nadal
  // prowadzi właściwy widok; akcje i tak rozstrzyga serwer.
  if (isError && currentUser === undefined) {
    return (
      <div className={styles.page}>
        <ErrorStateMolecule
          message={t('errorTitle')}
          retryLabel={t('retryBtn')}
          onRetry={() => void refetch()}
          isRetrying={isFetching}
        />
      </div>
    );
  }

  /* ─── EXPIRED — recovery window elapsed ─── */

  if (recoveryState === 'expired') {
    return (
      <div className={styles.page}>
        <AppHeroOrganism title={t('heroExpiredTitle')} />
        <ExpiredViewOrganism
          labels={{
            statusBody: t('expiredStatusBody'),
            gdprTitle: t('gdprTitle'),
            gdprBody: t('gdprBody'),
            gdprBtn: t('gdprBtn'),
            backLink: t('expiredBackLink'),
            dialogTitle: t('gdprDialogTitle'),
            dialogBody: t('gdprDialogBody'),
            dialogCancel: t('gdprDialogCancel'),
            dialogConfirm: t('gdprDialogConfirm'),
            dialogConfirming: t('gdprDialogConfirming'),
          }}
          isDialogOpen={isGdprDialogOpen}
          isErasing={gdprMutation.isPending}
          onOpenDialog={() => setIsGdprDialogOpen(true)}
          onBack={handleBackToLogin}
          onCloseDialog={() => setIsGdprDialogOpen(false)}
          onConfirmErase={handleConfirmErase}
        />
      </div>
    );
  }

  /* ─── ACTIVE — defensive hub (guard normally prevents reaching this) ─── */

  if (recoveryState === 'active') {
    return (
      <div className={styles.page}>
        <AppHeroOrganism title={t('heroActiveTitle')} />
        <RecoveryNoticeOrganism
          body={t('statusActiveBody')}
          action={
            <ButtonAtom
              direction='forward'
              variant='primary'
              size='lg'
              onClick={handleGoToDashboard}
              className='haptic-press'>
              {t('goToDashboard')}
            </ButtonAtom>
          }
        />
      </div>
    );
  }

  /* ─── RECOVERABLE — 90-day restore flow ─── */

  return (
    <div className={styles.page}>
      {/* The days-left number is stated ONCE on this screen: here. */}
      <AppHeroOrganism
        title={t('heroPendingTitle')}
        {...(daysLeft !== null
          ? { meta: <span>{t('daysLeft', { count: daysLeft })}</span> }
          : {})}
      />
      <RecoverableViewOrganism
        labels={{
          statusBody: t('statusBody'),
          restoreTitle: t('restoreTitle'),
          restoreItems,
          recoverBtn: t('recoverBtn'),
          cancelLink: t('cancelLink'),
          dialogTitle: t('dialogTitle'),
          dialogBody: t('dialogBody'),
          dialogCancel: t('dialogCancel'),
          dialogConfirm: t('dialogConfirm'),
          dialogConfirming: t('dialogConfirming'),
          trustAriaLabel: t('trustStripAriaLabel'),
          trustItems: [t('trustEncrypted'), t('trustPolish'), t('trustRodo')],
        }}
        isDialogOpen={isRecoverDialogOpen}
        isRecovering={reactivateMutation.isPending}
        onOpenDialog={() => setIsRecoverDialogOpen(true)}
        onCancel={handleBackToLogin}
        onCloseDialog={() => setIsRecoverDialogOpen(false)}
        onConfirmRecover={handleConfirmRecover}
      />
    </div>
  );
}

/* ─── Shell — carries the AppLayout (the one canonical "feature component
 * mounts the layout" pattern; see UI_ARCHITECTURE.md §Layout). Wrapping here
 * keeps every state (checking / error / recoverable / expired / active) inside
 * the same app chrome. ─── */

export function AccountRecoveryPageComposition() {
  const t = useTranslations('account.recovery');
  return (
    <AppLayoutComposition title={t('appBarTitle')}>
      <AccountRecoveryPageInner />
    </AppLayoutComposition>
  );
}
