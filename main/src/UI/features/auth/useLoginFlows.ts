// useLoginFlows.ts — login state + async flows for LoginPage.
// Split out of LoginPage.tsx to keep that file under 300 lines. This hook owns the form state
// (email, isSubmitting, error, magicLinkSent, socialLoading, resend state) and the async flows
// (magic-link submit and resend, dev quick-login, social sign-in) plus the controlled
// email-change handler. All DECISION / timing-gate comments are preserved.

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import {
  signIn,
  authClient,
} from '../../../application/auth/better-auth-client';
import { devLogin_IO } from '../../../domain/session/sessionIO.possibilities.api';
import { setCurrentUser } from '../../../application/stores/user-cache';
import {
  signInWithSocial,
  type SocialProvider,
} from '../../../application/auth/social-signin';
import { markLoginStarted } from '../../../application/auth/login-confirmation';
import { buildAuthRedirectTargets } from '../../../application/auth/post-login-return';
import { useAuth } from '../../contexts/AuthContext.composition';
import type { QuickLoginTile } from './LoginPage.tiles';
import {
  isRegisterIntent,
  magicLinkSendErrorKey,
  resolveLoginAttemptTarget,
} from './LoginPage.helpers';
import { appendFirstTouchToCallbackURL } from '../../../application/analytics/first-touch';
import { trackAuthStarted } from '../../../application/analytics/cta-events';
import { trackFlowStep } from '../../../application/analytics/flow-events';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { MAGIC_LINK_GATE_CODES } from '@kernel/application/auth/auth.config';

// DECISION: PERMISSIVE client-side email format gate, intentionally looser than the kernel
// validator (userValidators.userChangeEmail). That regex excludes '+' (plus-addressing), so reusing
// it here would lock plus-addressed accounts (name+tag@gmail.com, also any Google-OAuth mailbox
// containing '+') out of the SOLE login path with a misleading "invalid" error. Better Auth's send
// path accepts '+', so this gate must not be stricter than the backend. It only catches obviously
// malformed input (missing '@', missing domain dot, whitespace) to skip a pointless round trip;
// Better Auth stays the authoritative validator on send.
const CLIENT_EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface UseLoginFlowsArgs {
  /** Validated post-login target, UNPREFIXED: dev quick-login `router.replace`s
   *  to it (Next keeps the locale), and the magic-link / social channels derive
   *  their absolute, localized Better Auth targets from it at click time
   *  (`buildAuthRedirectTargets`, D6 + WS1). */
  postLoginTarget: string;
}

/** Resend on the "check your inbox" screen: idle → sending → sent | error. */
export type MagicLinkResendStatus = 'idle' | 'sending' | 'sent' | 'error';

type MagicLinkSendOutcome = { ok: true } | { ok: false; message: string };

interface UseLoginFlowsResult {
  email: string;
  isSubmitting: boolean;
  error: string | null;
  magicLinkSent: boolean;
  socialLoading: SocialProvider | null;
  resendStatus: MagicLinkResendStatus;
  resendError: string | null;
  /** The server asked for a Turnstile challenge before the next send (risk signal only). */
  turnstileRequired: boolean;
  /** Bumped after every send that carried a token: the token is single-use. */
  turnstileResetNonce: number;
  handleTurnstileToken: (token: string | null) => void;
  /** The form's email input (focused again after "change e-mail"). */
  emailInputRef: RefObject<HTMLInputElement | null>;
  handleMagicLinkSubmit: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
  /** Sends the link again to the SAME address, staying on the sent screen. */
  handleResend: () => Promise<void>;
  /** Back to the form with the address kept, so a typo is one edit away. */
  handleChangeEmail: () => void;
  handleQuickLogin: (tile: QuickLoginTile) => Promise<void>;
  handleSocialSignIn: (provider: SocialProvider) => Promise<void>;
  handleEmailChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function useLoginFlows({
  postLoginTarget,
}: UseLoginFlowsArgs): UseLoginFlowsResult {
  const router = useRouter();
  const t = useTranslations('pages.login');
  const tValidation = useTranslations('validation');

  // DECISION: pull `refetch` off useSession() to repopulate the REACTIVE session atom after a
  // dev-login. `authClient.getSession()` is an imperative proxy fetch whose /get-session path is
  // NOT in better-auth 1.6.3's $sessionSignal atomListeners matcher (client/config.mjs), so it does
  // not update the atom that AuthContext's useSession()/idle guard observes; only refetch()
  // (client/query.mjs, value.set()) does. Without it the idle-expiry guard sees a stale `session:
  // null` while the dev token IS present and bounces the freshly logged-in dev user back to
  // /user/login.
  const { refetch: refetchSession } = authClient.useSession();

  // DECISION: dev quick-login stamps the bearer token OUTSIDE the variant-C exchange path (via
  // http.interceptor), and `isLoggedIn` in AuthContext is a useState that does not react to a token
  // write in the SAME tab. Without an explicit re-sync the drawer/header render "Zaloguj się"
  // despite a valid token. See AuthContext.syncLoggedInFromStorage.
  const { syncLoggedInFromStorage } = useAuth();

  const [email, setEmail] = useState('');
  const emailEdited = useRef(false);
  useEffect(() => {
    const prefill = router.query['email'];
    if (
      router.isReady &&
      !emailEdited.current &&
      typeof prefill === 'string' &&
      prefill.length <= 254
    ) {
      setEmail(prefill);
    }
  }, [router.isReady, router.query]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [socialLoading, setSocialLoading] = useState<SocialProvider | null>(
    null
  );
  const [resendStatus, setResendStatus] =
    useState<MagicLinkResendStatus>('idle');
  const [resendError, setResendError] = useState<string | null>(null);
  // DECISION: Turnstile appears only after the server answers 428 with a TURNSTILE code (a risk
  // signal on the magic-link send, web-1 login-abuse/magic-link-send-gate.ts); a normal login never
  // loads the challenge. The token travels in a header and is spent by one send.
  const [turnstileRequired, setTurnstileRequired] = useState(false);
  const turnstileTokenRef = useRef<string | null>(null);
  const [turnstileResetNonce, setTurnstileResetNonce] = useState(0);
  const handleTurnstileToken = (token: string | null) => {
    turnstileTokenRef.current = token;
  };

  // "Zmień e-mail" on the sent screen remounts the form: put the caret back in
  // the kept address so fixing a typo is one step, not a hunt for the field.
  const emailInputRef = useRef<HTMLInputElement>(null);
  const focusEmailOnFormRef = useRef(false);
  useEffect(() => {
    if (!magicLinkSent && focusEmailOnFormRef.current) {
      focusEmailOnFormRef.current = false;
      emailInputRef.current?.focus();
    }
  }, [magicLinkSent]);

  // A successful social sign-in navigates the top-level window to the
  // provider. Coming back with the browser's Back button restores this page
  // from the back/forward cache with `socialLoading` still set, so every
  // provider button stayed disabled under a spinner with nothing in flight.
  // `pageshow` with `persisted` is exactly that restore.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setSocialLoading(null);
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  // Better Auth targets for one sign-in attempt. Built at click time, never in
  // render: the login page is prerendered and the origin exists only in the
  // browser. `decorate` adds the analytics tags to the success landing only.
  const authTargets = (decorate?: (path: string) => string) =>
    buildAuthRedirectTargets({
      target: resolveLoginAttemptTarget(
        postLoginTarget,
        window.location.search
      ),
      locale: router.locale,
      defaultLocale: router.defaultLocale,
      origin: window.location.origin,
      registerIntent: isRegisterIntent(router.query['intent']),
      ...(decorate ? { decorate } : {}),
    });

  // One send path for the form submit AND the resend on the sent screen, so
  // both carry the same callback targets and the same error mapping.
  const sendMagicLink = async (
    address: string
  ): Promise<MagicLinkSendOutcome> => {
    // Login-CSRF gate: this browser asked for a link, so the ?authCode it
    // brings back is exchanged without the "is this your account?" screen
    // (application/auth/login-confirmation.ts). Stamped before the request, a
    // failed send leaves a harmless marker that expires on its own.
    markLoginStarted();
    try {
      // Pass the resolved post-login target as Better Auth's callbackURL
      // so the magic-link click round-trip lands the user on the page they
      // originally wanted. resolvePostLoginTarget() validates the value.
      const { callbackURL, errorCallbackURL } = authTargets(path =>
        appendFirstTouchToCallbackURL(path, 'magic_link')
      );
      const turnstileToken = turnstileTokenRef.current;
      if (turnstileToken !== null) {
        turnstileTokenRef.current = null;
      }
      const result = await (async () =>
        signIn.magicLink({
          email: address,
          callbackURL,
          // D6: an expired/invalid link returns to the login screen in the same
          // language (`?error=` is read there) and with `from`, so asking for a
          // new link still ends on the page she wanted.
          errorCallbackURL,
          ...(turnstileToken !== null
            ? {
                fetchOptions: {
                  headers: { [CUSTOM_HEADERS.turnstileToken]: turnstileToken },
                },
              }
            : {}),
        }))().finally(() => {
        // The request can reach the server even when its response is lost.
        // Never reuse a challenge that may already have been consumed.
        if (turnstileToken !== null) {
          turnstileTokenRef.current = null;
          setTurnstileResetNonce(n => n + 1);
        }
      });
      if (result.error) {
        const code = result.error.code;
        if (
          code === MAGIC_LINK_GATE_CODES.TURNSTILE_REQUIRED ||
          code === MAGIC_LINK_GATE_CODES.TURNSTILE_INVALID
        ) {
          setTurnstileRequired(true);
          return { ok: false, message: t('turnstileNeeded') };
        }
        // Always the translated message — result.error.message is a raw
        // technical EN string from Better Auth, not user-facing copy.
        return {
          ok: false,
          message: t(magicLinkSendErrorKey(result.error.status)),
        };
      }
      return { ok: true };
    } catch {
      return { ok: false, message: t('connectionError') };
    }
  };

  const handleMagicLinkSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError(t('emailRequired'));
      return;
    }

    // The form is noValidate (native <input type=email> validation off), so a malformed address
    // ("notanemail") otherwise reaches Better Auth and surfaces the generic sendError ("failed to
    // send, try again"), which mis-frames a format error as a transient failure. Catch OBVIOUSLY
    // malformed input client-side FIRST (permissive gate above — allows '+') and show the specific
    // validation.email.invalid message; skip the pointless backend round-trip.
    if (!CLIENT_EMAIL_FORMAT.test(trimmedEmail)) {
      setError(tValidation('email.invalid'));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const outcome = await sendMagicLink(trimmedEmail);
    if (outcome.ok) {
      trackAuthStarted(
        'magic_link',
        isRegisterIntent(router.query['intent']) ? 'register' : 'login'
      );
      trackFlowStep('auth', 'magic_link_sent');
      setResendStatus('idle');
      setResendError(null);
      setMagicLinkSent(true);
    } else {
      trackFlowStep('auth', 'magic_link_failed');
      setError(outcome.message);
    }
    setIsSubmitting(false);
  };

  const handleResend = async () => {
    if (resendStatus === 'sending') {
      return;
    }
    setResendStatus('sending');
    setResendError(null);
    const outcome = await sendMagicLink(email.trim());
    if (outcome.ok) {
      trackFlowStep('auth', 'magic_link_resent');
      setResendStatus('sent');
    } else {
      trackFlowStep('auth', 'magic_link_failed', { attempt: 'resend' });
      setResendError(outcome.message);
      setResendStatus('error');
    }
  };

  const handleChangeEmail = () => {
    trackFlowStep('auth', 'email_changed');
    focusEmailOnFormRef.current = true;
    setResendStatus('idle');
    setResendError(null);
    setMagicLinkSent(false);
  };

  const handleQuickLogin = async (tile: QuickLoginTile) => {
    setIsSubmitting(true);
    setError(null);

    try {
      // devLogin_IO is promise-first. The former IO-layer side effect (setCurrentUser on the dev
      // token-stamp response) lives here in the caller, ordered BEFORE refetchSession()/router.push so
      // the cache is stamped before navigation.
      const currentUser = await devLogin_IO({ email: tile.email });
      void setCurrentUser(currentUser);

      // DECISION: a freshly logged-in dev user has a stale/unhydrated account_type in the Better
      // Auth session: refresh the session BEFORE navigating, otherwise useAppRole returns the stale
      // role (same mechanism as refreshSessionOnResume in AppLifecycle). Use refetchSession(), not
      // getSession() (see the DECISION on useSession above). DEV-only (panel behind isDev);
      // try/catch so a network failure cannot block navigation.
      try {
        await refetchSession();
      } catch {
        // Network down / token issue — navigation happens anyway, the role is picked up at the next
        // session refetch.
      }
      // Reconcile `isLoggedIn` (useState in AuthContext) with the freshly stored token, so the
      // logged-in shell (drawer/header) renders the logged-in state right after the SPA navigation:
      // the token stamp happened out-of-band (outside variant C).
      syncLoggedInFromStorage();
      // Route back to the originally-requested URL (validated via
      // resolvePostLoginTarget). Falls back to /app dashboard.
      // replace(), NOT push(): /user/login must not linger in SPA history, so a
      // post-login back-tap can't return to the login form (dev-only path).
      await router.replace(postLoginTarget);
    } catch {
      // Mirrors the former errorCallback('Login failed') path — dev-login failed
      // (network / backend gate). Keep the generic message; this panel is DEV-only.
      setError('Login failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSocialSignIn = async (provider: SocialProvider) => {
    setSocialLoading(provider);
    setError(null);
    const intent = isRegisterIntent(router.query['intent'])
      ? 'register'
      : 'login';
    if (provider === 'google') {
      trackAuthStarted('google', intent);
    }
    // Web success redirects the top-level window away; only a failure — or, on
    // native, completing the external-tab hand-off — returns here.
    const { error: socialError } = await signInWithSocial(
      provider,
      provider === 'google'
        ? authTargets(path => appendFirstTouchToCallbackURL(path, 'google'))
        : authTargets()
    );
    if (socialError) {
      trackFlowStep('auth', 'google_failed', { provider });
      setError(t('connectionError'));
    }
    setSocialLoading(null);
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    emailEdited.current = true;
    setEmail(e.target.value);
    if (error) {
      setError(null);
    }
  };

  return {
    email,
    isSubmitting,
    error,
    magicLinkSent,
    socialLoading,
    resendStatus,
    resendError,
    turnstileRequired,
    turnstileResetNonce,
    handleTurnstileToken,
    emailInputRef,
    handleMagicLinkSubmit,
    handleResend,
    handleChangeEmail,
    handleQuickLogin,
    handleSocialSignIn,
    handleEmailChange,
  };
}
