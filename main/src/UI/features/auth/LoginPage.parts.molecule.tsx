// LoginPage.parts.tsx — extracted sub-components for LoginPage.
// Split to keep each file under 300 lines.
//
// DECISION (nie usuwaj tego komentarza):
// Wave F (F1-02) removed the disabled "Wkrótce" SocialLoginButtons teaser. The
// real ENABLED Google/Apple buttons now live in SocialLoginSectionMolecule below,
// gated by NEXT_PUBLIC_OAUTH_ENABLED (whole section) + ENABLED_SOCIAL_PROVIDERS
// (per provider) — never re-introduce disabled teaser affordances that hurt trust.

import { useEffect, useId, useRef, useState } from 'react';
import { AppLinkAtom as Link } from '../../components/AppLink/AppLink.atom';
import type { useTranslations } from 'next-intl';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { BrandLockupMolecule } from '../../components/BrandLockup/BrandLockup.molecule';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  ENABLED_SOCIAL_PROVIDERS,
  type SocialProvider,
} from '../../../application/auth/social-signin';
import type { MagicLinkResendStatus } from './useLoginFlows';
import { useResendCountdown } from './hooks/useResendCountdown';
import styles from './LoginPage.module.css';
import { GoogleLogoAtom } from './GoogleLogo.atom';

/* ─── MagicLinkSent — „Sprawdź skrzynkę” after the link is sent ─── */

export type LoginT = ReturnType<typeof useTranslations<'pages.login'>>;

interface MagicLinkSentProps {
  email: string;
  /** Sends the link again to the same address (the "wyślij ponownie" promise). */
  onResend: () => void;
  /** Back to the form with the address kept, to fix a typo. */
  onChangeEmail: () => void;
  resendStatus: MagicLinkResendStatus;
  resendError: string | null;
  t: LoginT;
}

/* DECISION (nie usuwaj tego komentarza) — owner 2026-10-08:
 * ekran mówi, NA KTÓRY adres poszedł link, a ponowne wysłanie to jeden
 * przycisk `outlined` z widocznym odliczaniem. Przycisk ma pełną szerokość
 * i stałą wysokość, linia statusu pod nim jest zawsze zamontowana, więc ani
 * odliczanie, ani „wysłaliśmy ponownie”, ani błąd niczego nie przesuwają.
 * Wcześniej ponowienie było podkreślonym słowem w zdaniu, bez odliczania,
 * a kolejne komunikaty dokładały linie i spychały resztę w dół. */
export function MagicLinkSentMolecule({
  email,
  onResend,
  onChangeEmail,
  resendStatus,
  resendError,
  t,
}: MagicLinkSentProps) {
  const isResending = resendStatus === 'sending';
  // Each successful resend restarts the countdown.
  const [sendCount, setSendCount] = useState(0);
  const previousStatus = useRef(resendStatus);
  useEffect(() => {
    if (previousStatus.current !== 'sent' && resendStatus === 'sent') {
      setSendCount(count => count + 1);
    }
    previousStatus.current = resendStatus;
  }, [resendStatus]);
  const secondsLeft = useResendCountdown(sendCount);
  const isCoolingDown = secondsLeft > 0;

  // The form that sent the link (and its focused submit button) unmounts when
  // this screen replaces it, so focus fell to <body>: the next Tab restarted
  // at the top of the page. Only a LOST focus is moved onto the title.
  const titleId = useId();
  useEffect(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) {
      document.getElementById(titleId)?.focus({ preventScroll: true });
    }
  }, [titleId]);

  const statusText =
    resendStatus === 'sending'
      ? t('sending')
      : resendStatus === 'sent'
        ? t('magicLinkResent')
        : '';

  return (
    <div className={styles.wrapper}>
      <div className={styles.homeReturn}>
        <Link href={ROUTES_FRONT.HOME} className={styles.homeReturnLink}>
          <ArrowLeftIcon
            size={16}
            weight='bold'
            className={styles.homeReturnIcon}
            aria-hidden='true'
          />
          <span>{t('backToHome')}</span>
        </Link>
      </div>

      <div className={styles.card}>
        <div className={styles.logoSection}>
          <BrandLockupMolecule
            className={styles.brandLockup}
            markClassName={styles.brandMark}
          />
          <h1 id={titleId} tabIndex={-1} className={styles.headline}>
            {t('magicLinkTitle')}
          </h1>
          <p className={styles.subtitle}>
            {t.rich('magicLinkDesc', {
              email,
              strong: chunks => (
                <strong className={styles.sentEmail}>{chunks}</strong>
              ),
            })}
          </p>
        </div>

        <div className={styles.sentActions}>
          <p className={styles.sentHint}>{t('magicLinkHint')}</p>
          <ButtonAtom
            variant='outlined'
            size='lg'
            className={`${styles.submitButton} ${isCoolingDown ? styles.inert : ''} haptic-press`}
            // aria-disabled, not disabled: the tapped button keeps focus while
            // the send is in flight (a disabled one drops it to <body>).
            aria-disabled={isResending || isCoolingDown}
            loading={isResending}
            onClick={() => {
              if (!isResending && !isCoolingDown) {
                onResend();
              }
            }}>
            {isCoolingDown
              ? t.rich('magicLinkResendIn', {
                  seconds: secondsLeft,
                  n: chunks => (
                    <span className={styles.countdown}>{chunks}</span>
                  ),
                })
              : t('magicLinkResend')}
          </ButtonAtom>
          {/* Always mounted, one reserved line: sending, sent again or the
              refusal appear without moving anything. */}
          <p
            className={styles.sentStatus}
            data-tone={resendStatus === 'error' ? 'error' : 'neutral'}
            role={resendStatus === 'error' ? 'alert' : 'status'}
            aria-live='polite'>
            {resendStatus === 'error' && resendError !== null
              ? resendError
              : statusText}
          </p>
          <p className={styles.sentHint}>
            {t.rich('magicLinkWrongEmail', {
              change: chunks => (
                <button
                  type='button'
                  className={`${styles.inlineLink} haptic-press`}
                  disabled={isResending}
                  onClick={onChangeEmail}>
                  {chunks}
                </button>
              ),
            })}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── SocialLoginSection — provider buttons under the e-mail form ─── */

interface SocialLoginSectionProps {
  socialLoading: SocialProvider | null;
  onSocialSignIn: (provider: SocialProvider) => void;
  t: LoginT;
}

// DECISION (nie usuwaj tego komentarza):
// Wave F (F1-02) — disabled Google/Apple "Wkrótce" buttons were REMOVED: a
// blocked affordance shouts "this app is unfinished". The buttons are ENABLED
// or absent, never disabled teasers. Per-provider visibility comes from
// ENABLED_SOCIAL_PROVIDERS (SSOT in social-signin.ts), so flipping the OAuth
// flag never surfaces a button for a provider that would fail on click.
// Owner 2026-10-08: the providers sit UNDER the e-mail form as `outlined`
// buttons of the same height as the filled „Kontynuuj”, which stays the one
// filled action of the screen. The caller renders this section only when
// OAuth is on.
export function SocialLoginSectionMolecule({
  socialLoading,
  onSocialSignIn,
  t,
}: SocialLoginSectionProps) {
  return (
    <div className={styles.socialSection}>
      <p className={styles.orLine}>{t('or')}</p>
      {ENABLED_SOCIAL_PROVIDERS.includes('google') && (
        <ButtonAtom
          variant='outlined'
          size='lg'
          className={`${styles.submitButton} haptic-press`}
          // The ONE provider whose hand-off is in flight spins; the other is
          // only disabled, so the pending one is identifiable.
          disabled={socialLoading !== null && socialLoading !== 'google'}
          loading={socialLoading === 'google'}
          icon={<GoogleLogoAtom />}
          onClick={() => onSocialSignIn('google')}>
          {socialLoading === 'google' ? t('socialPending') : t('googleBtn')}
        </ButtonAtom>
      )}
      {ENABLED_SOCIAL_PROVIDERS.includes('apple') && (
        <ButtonAtom
          variant='outlined'
          size='lg'
          className={`${styles.submitButton} haptic-press`}
          disabled={socialLoading !== null && socialLoading !== 'apple'}
          loading={socialLoading === 'apple'}
          onClick={() => onSocialSignIn('apple')}>
          {socialLoading === 'apple' ? t('socialPending') : t('appleBtn')}
        </ButtonAtom>
      )}
    </div>
  );
}
