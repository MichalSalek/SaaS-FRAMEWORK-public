import { useEffect, useId, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { BrandLockupMolecule } from '../../components/BrandLockup/BrandLockup.molecule';
import { useAuth } from '../../contexts/AuthContext.composition';
import type { LoginConfirmation } from '../../contexts/useLoginConfirmationGate';
import loginStyles from './LoginPage.module.css';
import styles from './LoginConfirm.module.css';

/**
 * s34 login-CSRF gate (application/auth/login-confirmation.ts).
 *
 * DECISION (nie usuwaj tego komentarza):
 * Mounted in _app INSIDE NextIntlClientProvider (the screen needs copy) and
 * AROUND AppLifecycle and the page, so while a fresh ?authCode login waits for
 * "Tak, to moje konto" nothing of the app mounts: no page, no analytics
 * identify, no queries. The harm of a handed-over login link is what the victim
 * does AFTER landing, so a banner over a live app would not be enough.
 * AuthProvider itself cannot render this screen: it sits above the i18n
 * provider (its own pre-exchange fallback is deliberately copy-free).
 */
export function LoginConfirmGateComposition({
  children,
}: {
  children: ReactNode;
}) {
  const { loginConfirmation, confirmFreshLogin, rejectFreshLoginAndReload } =
    useAuth();
  if (loginConfirmation === null) {
    return <>{children}</>;
  }
  return (
    <LoginConfirmScreen
      status={loginConfirmation.status}
      email={loginConfirmation.email}
      onConfirm={confirmFreshLogin}
      onReject={rejectFreshLoginAndReload}
    />
  );
}

interface LoginConfirmScreenProps {
  status: LoginConfirmation['status'];
  /** The NEW session's address, fetched with the unconfirmed token itself. */
  email: string | null;
  onConfirm: () => void;
  onReject: () => void;
}

function LoginConfirmScreen({
  status,
  email,
  onConfirm,
  onReject,
}: LoginConfirmScreenProps) {
  const t = useTranslations('components.loginConfirm');
  const titleId = useId();

  // Nothing had focus on the pre-exchange fallback, so start the reading order
  // (and the screen reader) at the question itself.
  useEffect(() => {
    document.getElementById(titleId)?.focus({ preventScroll: true });
  }, [titleId]);

  return (
    <main className={loginStyles.wrapper} aria-labelledby={titleId}>
      <div className={loginStyles.card}>
        <div className={loginStyles.logoSection}>
          <BrandLockupMolecule
            className={loginStyles.brandLockup}
            markClassName={loginStyles.brandMark}
          />
          <h1
            id={titleId}
            tabIndex={-1}
            className={`${loginStyles.headline} ${styles.title}`}>
            {email === null || email === '' ? (
              t('titleNoEmail')
            ) : (
              <>
                {t('title')}
                <span className={styles.email}>{email}</span>
              </>
            )}
          </h1>
          <TypographyAtom variant='body2' className={loginStyles.subtitle}>
            {t('body')}
          </TypographyAtom>
        </div>

        <div className={styles.actions}>
          <ButtonAtom
            variant='primary'
            size='lg'
            className={`${loginStyles.submitButton} haptic-press`}
            loading={status === 'confirming'}
            disabled={status === 'rejecting'}
            onClick={onConfirm}>
            {t('confirm')}
          </ButtonAtom>
          <ButtonAtom
            variant='outlined'
            size='lg'
            className={`${loginStyles.submitButton} haptic-press`}
            loading={status === 'rejecting'}
            disabled={status === 'confirming'}
            onClick={onReject}>
            {status === 'rejecting' ? t('rejecting') : t('reject')}
          </ButtonAtom>
        </div>
      </div>
    </main>
  );
}
