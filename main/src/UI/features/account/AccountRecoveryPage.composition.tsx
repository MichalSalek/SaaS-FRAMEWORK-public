import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { hasSessionToken } from '../../shared/hooks/currentUser.query';
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

  // DECISION: mount-gate, same reason as AccountPayPage.composition.tsx (auth-gated account, SSR
  // does not know the session): SSR and the first CSR render the identical CheckingState, content
  // only after mount.
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
        // Query invalidation flips state to ACTIVE; the interceptor toasts
        // ACCOUNT_REACTIVATED (a local push of the same event repeated it).
        setIsRecoverDialogOpen(false);
      },
      onError: () => {
        setIsRecoverDialogOpen(false);
        // DECISION: the error toast belongs to the HTTP interceptor (event-bus Stage 1:
        // ACCOUNT_REACTIVATION_FAILED on 409, INTERNET_CONNECTION_PROBLEM on network); a local push
        // duplicated it (a different event on the network path → no dedup → double toast). The
        // refetch STAYS: the recovery window may have just ended (race with the cron) and re-reading
        // the state switches the view to EXPIRED.
        void refetch();
      },
    });
  };

  const handleConfirmErase = () => {
    gdprMutation.mutate(undefined, {
      onSuccess: () => {
        setIsGdprDialogOpen(false);
      },
      onError: () => {
        setIsGdprDialogOpen(false);
        // DECISION: the error toast belongs to the HTTP interceptor (backend error event, or
        // INTERNET_CONNECTION_PROBLEM on network); a local GENERAL_ERROR push duplicated it.
      },
    });
  };

  const handleBackToLogin = () => {
    void router.push({
      pathname: ROUTES_FRONT.USER_LOG,
      query: { from: ROUTES_FRONT.USER_RECOVER },
    });
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
              className='press-feedback'>
              {t('goToLogin')}
            </ButtonAtom>
          }
        />
      </div>
    );
  }

  // Error only without data: a failed background refresh (e.g. a refetch after
  // a failed restore) leaves the last account state cached, which still drives
  // the right view; the server decides every action anyway.
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
              className='press-feedback'>
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
