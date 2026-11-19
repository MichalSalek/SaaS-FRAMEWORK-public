// LoginPage.parts.tsx — extracted sub-components for LoginPage.
// Split to keep each file under 300 lines.
//

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AppLinkAtom as Link } from '../../components/AppLink/AppLink.atom';
import type { useTranslations } from 'next-intl';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { BrandLockupMolecule } from '../../components/BrandLockup/BrandLockup.molecule';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { legalLinkChunks } from '../shared/legal/legal-link-chunks.helpers';
import {
  ENABLED_SOCIAL_PROVIDERS,
  type SocialProvider,
} from '../../../application/auth/social-signin';
import type { MagicLinkResendStatus } from './useLoginFlows';
import { useResendCountdown } from './hooks/useResendCountdown';
import styles from './LoginPage.module.css';
import { CompletionLineMolecule } from '../../components/OutcomeFeedback/CompletionLine.molecule';
import { SuccessSceneOrganism } from '../../components/OutcomeFeedback/SuccessScene.organism';
import { LoginGoogleSlotMolecule } from './LoginGoogleSlot.molecule';

/* ─── MagicLinkSent — „Sprawdź skrzynkę” after the link is sent ─── */

export type LoginT = ReturnType<typeof useTranslations<'pages.login'>>;

interface MagicLinkSentProps {
  email: string;
  registerIntent: boolean;
  /** Sends the link again to the same address (the "wyślij ponownie" promise). */
  onResend: () => void;
  /** Back to the form with the address kept, to fix a typo. */
  onChangeEmail: () => void;
  resendStatus: MagicLinkResendStatus;
  resendError: string | null;
  /** Turnstile challenge, present only after the server asked for one. */
  turnstile: ReactNode;
  t: LoginT;
}

/* DECISION: the screen says WHICH address the link went to, and resending is one `outlined`
   button with a visible countdown. The button has full width and a fixed height, and the status
   line under it is always mounted, so neither the countdown nor "sent again" nor an error shifts
   anything. Resending used to be an underlined word in a sentence, with no countdown, and each
   new message added lines and pushed the rest down. (owner) */
export function MagicLinkSentMolecule({
  email,
  registerIntent,
  onResend,
  onChangeEmail,
  resendStatus,
  resendError,
  turnstile,
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
      const title = document.getElementById(titleId);
      title?.setAttribute('tabindex', '-1');
      title?.focus({ preventScroll: true });
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
        </div>
        <SuccessSceneOrganism
          titleId={titleId}
          title={t('magicLinkTitle')}
          body={
            // SuccessScene's body is a column flex, so each rich-text node
            // (the sentence, the address, the period after it) became its own
            // line. The address is the bold line; the period sat under it.
            <p className={styles.sentLead}>
              {t.rich(
                registerIntent ? 'magicLinkRegisterDesc' : 'magicLinkDesc',
                {
                  email,
                  strong: chunks => (
                    <strong className={styles.sentEmail}>{chunks}</strong>
                  ),
                }
              )}
            </p>
          }
          actions={
            <div className={styles.sentActions}>
              <p className={styles.sentHint}>{t('magicLinkHint')}</p>
              {turnstile}
              <ButtonAtom
                variant='outlined'
                size='lg'
                className={`${styles.submitButton} ${isCoolingDown ? styles.inert : ''} press-feedback`}
                // aria-disabled, not disabled: the tapped button keeps focus while
                // the send is in flight (a disabled one drops it to <body>).
                aria-disabled={isResending || isCoolingDown}
                loading={isResending}
                onClick={() => {
                  if (!isResending && !isCoolingDown) {
                    onResend();
                  }
                }}>
                {isCoolingDown ? (
                  // ButtonInner's label is inline-flex. A seconds span sitting
                  // among the message's text nodes is its own flex item, and
                  // the spaces in "za 30 s" / "in 30 s" collapse. Two digits
                  // then touch the previous word; one digit still looks spaced
                  // because it is centered in the 2ch box. One inline wrapper
                  // keeps the spaces the PL/EN/DE messages already contain.
                  <span className={styles.resendLabel}>
                    {t.rich('magicLinkResendIn', {
                      seconds: secondsLeft,
                      n: chunks => (
                        <span className={styles.countdown}>{chunks}</span>
                      ),
                    })}
                  </span>
                ) : (
                  t('magicLinkResend')
                )}
              </ButtonAtom>
              <CompletionLineMolecule
                state={
                  resendStatus === 'sending'
                    ? 'pending'
                    : resendStatus === 'sent'
                      ? 'complete'
                      : resendStatus === 'error'
                        ? 'error'
                        : 'idle'
                }
                message={
                  resendStatus === 'error' && resendError !== null
                    ? resendError
                    : statusText
                }
                reserveMessage={resendError ?? t('magicLinkResent')}
              />
              <p className={styles.sentHint}>
                {t.rich('magicLinkWrongEmail', {
                  change: chunks => (
                    <button
                      type='button'
                      className={`${styles.inlineLink} press-feedback`}
                      disabled={isResending}
                      onClick={onChangeEmail}>
                      {chunks}
                    </button>
                  ),
                })}
              </p>
            </div>
          }
        />
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

// DECISION: disabled "Wkrótce" Google/Apple buttons were REMOVED: a blocked affordance shouts "this
// app is unfinished"; buttons are ENABLED or absent, never disabled teasers. Per-provider
// visibility comes from ENABLED_SOCIAL_PROVIDERS (SSOT in social-signin.ts), so flipping the OAuth
// flag (NEXT_PUBLIC_OAUTH_ENABLED, the whole section) never surfaces a button for a provider that
// would fail on click. The providers sit UNDER the e-mail form as `outlined` buttons of the same
// height as the filled "Kontynuuj", which stays the one filled action. The caller renders this
// section only when OAuth is on. (owner)
export function SocialLoginSectionMolecule({
  socialLoading,
  onSocialSignIn,
  t,
}: SocialLoginSectionProps) {
  return (
    <div className={styles.socialSection}>
      <p className={styles.orLine}>{t('or')}</p>
      {ENABLED_SOCIAL_PROVIDERS.includes('google') && (
        <LoginGoogleSlotMolecule
          socialLoading={socialLoading}
          onSocialSignIn={onSocialSignIn}
          t={t}
        />
      )}
      {ENABLED_SOCIAL_PROVIDERS.includes('apple') && (
        <ButtonAtom
          variant='outlined'
          size='lg'
          className={`${styles.submitButton} press-feedback`}
          disabled={socialLoading !== null && socialLoading !== 'apple'}
          loading={socialLoading === 'apple'}
          onClick={() => onSocialSignIn('apple')}>
          {socialLoading === 'apple' ? t('socialPending') : t('appleBtn')}
        </ButtonAtom>
      )}
    </div>
  );
}

// The terms line under the login buttons (owner wording: by logging in you accept the terms and
// the privacy policy). Continuing accepts them; no checkbox anywhere on the way in. The age
// declaration is stated once, on the onboarding screen that creates the account.
export function LoginTermsNoticeMolecule({ t }: { t: LoginT }) {
  return (
    <p className={styles.termsNotice}>
      {t.rich('termsNotice', legalLinkChunks(styles.termsNoticeLink))}
    </p>
  );
}

/** Under the e-mail form: the providers (when OAuth is on) and the terms line,
 *  which is shown either way. */
export function LoginAlternativesMolecule({
  oauthEnabled,
  ...social
}: SocialLoginSectionProps & { oauthEnabled: boolean }) {
  return (
    <>
      {oauthEnabled ? <SocialLoginSectionMolecule {...social} /> : null}
      <LoginTermsNoticeMolecule t={social.t} />
    </>
  );
}
