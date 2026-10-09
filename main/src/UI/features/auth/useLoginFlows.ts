// useLoginFlows.ts — login state + async flows for LoginPage.
// Split out of LoginPage.tsx (FDX FAZA 3 / W3.5) to keep that file under 300
// lines. This hook owns the form state (email, isSubmitting, error,
// magicLinkSent, socialLoading, resend state) and the async flows (magic-link
// submit and resend, dev quick-login, social sign-in) plus the controlled
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
import { useAuth } from '../../contexts/AuthContext.composition';
import type { QuickLoginTile } from './LoginPage.tiles';
import { magicLinkSendErrorKey } from './LoginPage.helpers';

// DECISION (nie usuwaj tego komentarza): PERMISSIVE client-side email format gate
// (S65). INTENTIONALLY looser than the kernel SSOT validator
// (userValidators.userChangeEmail): that regex excludes '+' (plus-addressing), so
// reusing it here would lock plus-addressed accounts (name+tag@gmail.com — common
// for beta testers, and any Google-OAuth mailbox containing '+') out of the SOLE
// login path with a misleading "invalid" error. Better Auth's send path accepts
// '+', so this gate must not be stricter than the backend. It only catches
// OBVIOUSLY malformed input (missing '@', missing domain dot, whitespace) to skip a
// pointless round-trip + the mis-framing generic sendError; Better Auth remains the
// authoritative validator on send.
const CLIENT_EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface UseLoginFlowsArgs {
  /** Resolved (locale-prefixed, D6) Better Auth callbackURL for the magic-link
   *  round-trip AND the social sign-in landing — one target for every channel. */
  magicLinkCallback: string;
  /** Localized login path Better Auth redirects to on a failed verify/callback. */
  errorCallback: string;
  /** Validated post-login redirect target for dev quick-login — UNPREFIXED:
   *  `router.replace` keeps the current locale by itself (see post-login-return). */
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
  magicLinkCallback,
  errorCallback,
  postLoginTarget,
}: UseLoginFlowsArgs): UseLoginFlowsResult {
  const router = useRouter();
  const t = useTranslations('pages.login');
  const tValidation = useTranslations('validation');

  // DECISION (nie usuwaj tego komentarza):
  // We pull `refetch` off useSession() to repopulate the REACTIVE session atom
  // after a dev-login. `authClient.getSession()` is an imperative proxy fetch
  // whose /get-session path is NOT in better-auth 1.6.3's $sessionSignal
  // atomListeners matcher (client/config.mjs), so it does NOT update the atom that
  // AuthContext's useSession()/idle-guard observes — only refetch() (client/query.mjs
  // → value.set()) does. Without this, the idle-expiry guard in AuthContext sees a
  // stale `session:null` while the dev token IS present right after nav and bounces
  // the freshly-logged-in dev user back to /user/login.
  const { refetch: refetchSession } = authClient.useSession();

  // DECISION (nie usuwaj): dev quick-login stempluje bearer token POZA ścieżką
  // variant-C exchange (przez http.interceptor), a `isLoggedIn` w AuthContext to
  // useState niereaktywny na zapis tokenu w TYM SAMYM tabie. Bez jawnego re-sync
  // drawer/header renderują "Zaloguj się" mimo ważnego tokenu. Szczegóły:
  // AuthContext.syncLoggedInFromStorage (DECISION przy definicji).
  const { syncLoggedInFromStorage } = useAuth();

  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [socialLoading, setSocialLoading] = useState<SocialProvider | null>(
    null
  );
  const [resendStatus, setResendStatus] =
    useState<MagicLinkResendStatus>('idle');
  const [resendError, setResendError] = useState<string | null>(null);

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

  // One send path for the form submit AND the resend on the sent screen, so
  // both carry the same callback targets and the same error mapping.
  const sendMagicLink = async (
    address: string
  ): Promise<MagicLinkSendOutcome> => {
    // s34 login-CSRF gate: this browser asked for a link, so the ?authCode it
    // brings back is exchanged without the "is this your account?" screen
    // (application/auth/login-confirmation.ts). Stamped before the request, a
    // failed send leaves a harmless marker that expires on its own.
    markLoginStarted();
    try {
      // DD2-D7: pass the resolved post-login target as Better Auth's callbackURL
      // so the magic-link click round-trip lands the user on the page they
      // originally wanted. resolvePostLoginTarget() validates the value.
      const result = await signIn.magicLink({
        email: address,
        callbackURL: magicLinkCallback,
        // D6: an expired/invalid link returns to the login screen in the same
        // language (`?error=` is read there), not to the Polish default.
        errorCallbackURL: errorCallback,
      });
      if (result.error) {
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

    // The form is noValidate (native <input type=email> validation off), so a
    // malformed address ("notanemail") otherwise reaches Better Auth and surfaces
    // the generic sendError ("failed to send, try again") — which mis-frames a
    // format error as a transient failure (S65). Catch OBVIOUSLY malformed input
    // client-side FIRST (permissive gate above — allows '+') and show the specific
    // validation.email.invalid message; skip the pointless backend round-trip.
    if (!CLIENT_EMAIL_FORMAT.test(trimmedEmail)) {
      setError(tValidation('email.invalid'));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const outcome = await sendMagicLink(trimmedEmail);
    if (outcome.ok) {
      setResendStatus('idle');
      setResendError(null);
      setMagicLinkSent(true);
    } else {
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
      setResendStatus('sent');
    } else {
      setResendError(outcome.message);
      setResendStatus('error');
    }
  };

  const handleChangeEmail = () => {
    focusEmailOnFormRef.current = true;
    setResendStatus('idle');
    setResendError(null);
    setMagicLinkSent(false);
  };

  const handleQuickLogin = async (tile: QuickLoginTile) => {
    setIsSubmitting(true);
    setError(null);

    try {
      // FDX FAZA 2: devLogin_IO is promise-first now. The former IO-layer
      // side-effect (setCurrentUser on the dev token-stamp response) lives here
      // in the caller, ordered BEFORE refetchSession()/router.push so the cache
      // is stamped before navigation — behaviour 1:1 with the old successCallback.
      const currentUser = await devLogin_IO({ email: tile.email });
      void setCurrentUser(currentUser);

      // DECISION (nie usuwaj): świeżo zalogowany dev-user ma w BA session stary/
      // niezhydratowany account_type — odśwież sesję PRZED nav, inaczej
      // useAppRole zwraca stale rolę → zły dashboard (ten sam mechanizm co
      // refreshSessionOnResume w AppLifecycle). DEV-only (panel za isDev). try/catch
      // by fail sieci nie zablokował nawigacji. S16 fix.
      //
      // Używamy refetchSession() (reactive atom refetch), NIE
      // authClient.getSession(): w better-auth 1.6.3 /get-session NIE jest w
      // matcherze $sessionSignal (client/config.mjs), więc getSession() nie
      // aktualizuje atomu useSession(). refetch() robi value.set()
      // (client/query.mjs) → atom, który obserwuje idle-guard w AuthContext, ma
      // świeżą sesję ZANIM guard re-run zobaczy token-present + session-null
      // (inaczej wybiłby świeżo zalogowanego dev-usera do /user/login).
      try {
        await refetchSession();
      } catch {
        // Network down / token issue — nav i tak następuje, rola dociągnie się
        // przy najbliższym refetchu sesji.
      }
      // Pogódź `isLoggedIn` (useState w AuthContext) ze świeżo zapisanym tokenem,
      // żeby zalogowana powłoka (drawer/header) od razu po SPA-nav renderowała
      // stan logged-in — token-stamp nastąpił out-of-band (poza variant-C).
      syncLoggedInFromStorage();
      // DD2-D7: route back to the originally-requested URL (validated via
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
    // Web success redirects the top-level window away; only a failure — or, on
    // native, completing the external-tab hand-off — returns here.
    const { error: socialError } = await signInWithSocial(provider, {
      returnPath: magicLinkCallback,
      errorReturnPath: errorCallback,
    });
    if (socialError) {
      setError(t('connectionError'));
    }
    setSocialLoading(null);
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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
    emailInputRef,
    handleMagicLinkSubmit,
    handleResend,
    handleChangeEmail,
    handleQuickLogin,
    handleSocialSignIn,
    handleEmailChange,
  };
}
