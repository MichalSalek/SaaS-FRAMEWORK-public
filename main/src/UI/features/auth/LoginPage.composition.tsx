import { DisclosureMolecule } from '../../components/Disclosure/Disclosure.molecule';
import { useEffect, useState } from 'react';
import { AppLinkAtom as Link } from '../../components/AppLink/AppLink.atom';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ArrowLeftIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { InputAtom } from '../../components/Input/Input.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../components/NavRow/NavRow.molecule';
import { BrandLockupMolecule } from '../../components/BrandLockup/BrandLockup.molecule';
import {
  IS_DEVELOPMENT_ENV,
  IS_OAUTH_ENABLED,
} from '../../../application/environment/environment.possibilities.api';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { PLATFORM_CONFIG } from '@kernel/domain/platform/platform.config';
import { usePricingFunnelState } from '../../shared/hooks/usePricingFunnelState';
import {
  MagicLinkSentMolecule,
  LoginAlternativesMolecule,
} from './LoginPage.parts.molecule';
import { QuickLoginPanelMolecule } from './LoginPage.quickLogin.molecule';
import { readPrefilledRole } from './onboarding.helpers';
import {
  resolvePostLoginTarget,
  isFromAccountRecovery,
  isRegisterIntent,
  resolvePlanBannerName,
  isFromStylistProfile,
  isFromProfileMessage,
  resolveAuthErrorKey,
  isNativeAuthReturn,
} from './LoginPage.helpers';
import { useLoginFlows } from './useLoginFlows';
import { TurnstileWidgetAtom } from '../../components/Turnstile/TurnstileWidget.atom';
import { useLoggedInRedirectGuard } from '../../layouts/guards/useLoggedInRedirectGuard';
import styles from './LoginPage.module.css';

// ---------------------------------------------------------------------------
// LoginPage
// ---------------------------------------------------------------------------

/**
 * LoginPage — standalone auth screen.
 *
 * Layout: no PublicLayout, no AppLayout. Full-viewport card.
 * Flow:
 *   1. User enters email -> "Kontynuuj" -> sends magic link
 *   2. Success -> shows confirmation message
 *   3. DEV/STAGING only: Quick Login tiles -> devLogin_IO (bypasses magic link)
 */
export function LoginPageComposition() {
  const router = useRouter();
  const t = useTranslations('pages.login');

  // An already-authenticated visitor must never sit on the login form — bounce
  // a LIVE session to /app (SSOT: DISALLOWED_ROUTES_FOR_ANY_ALREADY_LOGGED_ROLE).
  // Flicker-free: a stale token / pending session is NOT bounced (guard internals).
  useLoggedInRedirectGuard();

  const isDev = IS_DEVELOPMENT_ENV();
  const oauthEnabled = IS_OAUTH_ENABLED();

  // Capture the originally-requested URL from `?from=...` so we can
  // deliver the user back after login.
  const postLoginTarget = resolvePostLoginTarget(router.query['from']);

  // Switch to registration-oriented copy when a marketing CTA
  // links here with `?intent=register`.
  const registerIntent = isRegisterIntent(router.query['intent']);

  // A guest who tapped a client-only action on a public stylist profile
  // ("Poproś o połączenie" / bookmark) lands here with `?from=/stylist/<id>`.
  // The generic stylist-oriented header ("…dla stylistek paznokci") loses the
  // pairing context, so surface a short banner naming their real intent.
  const fromStylistProfile = isFromStylistProfile(router.query['from']);
  const fromProfileMessage = isFromProfileMessage(router.query['from']);

  // Logging in to restore a closed account (`?from=/app/user/recover`): this
  // screen is the logged-out version of the recovery page (DECISION in
  // isFromAccountRecovery), so it takes that page's title and explanation.
  const recoveryContext = isFromAccountRecovery(router.query['from']);

  // H-FUNNEL-1/2: a marketing CTA can carry ?role=stylist|client (UX hint only).
  // When present, point the magic-link callback straight at onboarding with the
  // role pre-selected — this revives the previously starved readPrefilledRole /
  // role preselection path (nothing upstream fed ?role into /app/onboarding before).
  // SECURITY: the URL role only pre-selects a *changeable* onboarding radio; the
  // authoritative account type is created from the submitted form + session, never
  // from this param. readPrefilledRole validates strictly to 'stylist' | 'client'.
  const prefilledRole = readPrefilledRole(router.query);

  // A failed provider login returns here with a code in the address (`?error=…`, appended by Better
  // Auth). Without reading it the screen looks as if nothing happened, and the user cannot tell
  // whether they clicked wrong or the app rejected them. `nativeAuth=1` adds the information that
  // we are in an external browser opened by the app.
  const authErrorKey = resolveAuthErrorKey(router.query['error']);
  const nativeAuthReturn = isNativeAuthReturn(router.query['nativeAuth']);

  // A /pricing CTA carries the chosen plan via
  // `?planId=&billingPeriod=` (hybrid precedence: query > sessionStorage). When
  // a plan intent is present, this is a NEW-account funnel — point post-login at
  // onboarding (account creation) rather than the generic dashboard/pay deep-link,
  // and persist the choice to sessionStorage so it survives the magic-link
  // round-trip (Better Auth fixes the callbackURL, not arbitrary funnel state).
  // The pay surface reads + clears the funnel on consumption.
  const { setPricingFunnel, getPricingFunnel } = usePricingFunnelState();
  const pricingFunnel = getPricingFunnel();
  // Mount-gate the plan-aware banner: getPricingFunnel() reads sessionStorage, which
  // is empty during SSG/SSR (login is static) but populated on the client. Rendering
  // the banner directly on the first client render would diverge from the server HTML
  // (hydration mismatch). Defer the banner to post-mount, mirroring the established
  // pattern (HeaderUserMenu / AccountPayPage). The funnel value still drives the
  // post-login target via event handlers (read at click time, SSR-safe).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  // The connect-from-profile context WINS over a stale funnel intent: a visitor who earlier clicked
  // a plan CTA and then opened a stylist profile and chose „poproś o połączenie" arrives here as a
  // CLIENT — a „Wybrałaś plan Pro" banner next to the connect context is a contradictory message
  // (a client does not buy a plan). The priority mirrors the subtitle below (registerIntent >
  // connect > default). The funnel state in sessionStorage stays untouched — a stylist returning to
  // signup still gets her plan.
  const planBannerName =
    mounted && !fromStylistProfile
      ? resolvePlanBannerName(pricingFunnel?.planId)
      : null;
  // Persist the resolved choice so it survives the magic-link round-trip.
  // Depend on the PRIMITIVE planId/billingPeriod (not the freshly-built object,
  // which has a new identity every render) so the write fires only when the
  // actual choice changes — re-writes of the same value are skipped.
  const funnelPlanId = pricingFunnel?.planId ?? null;
  const funnelBillingPeriod = pricingFunnel?.billingPeriod ?? null;
  useEffect(() => {
    if (funnelPlanId !== null && funnelBillingPeriod !== null) {
      setPricingFunnel({
        planId: funnelPlanId,
        billingPeriod: funnelBillingPeriod,
      });
    }
  }, [funnelPlanId, funnelBillingPeriod, setPricingFunnel]);

  // Better Auth preserves the callbackURL query string across the magic-link email
  // round-trip, so landing on /app/onboarding?role=... carries the hint end-to-end.
  // Onboarding is the landing target whenever there is a role hint OR a plan
  // intent (both signal a NEW-account funnel); otherwise the validated deep-link.
  const onboardingTarget = prefilledRole
    ? `${ROUTES_FRONT.ONBOARDING}?role=${prefilledRole}`
    : ROUTES_FRONT.ONBOARDING;
  const wantsOnboarding = prefilledRole != null || pricingFunnel !== null;
  // Dev quick-login / instant flows reuse the same target so the funnel is
  // consistent across every login channel. UNPREFIXED on purpose: router.replace
  // keeps the current locale (D6, DECISION in post-login-return.ts).
  const resolvedPostLoginTarget = wantsOnboarding
    ? onboardingTarget
    : postLoginTarget;
  // D6 + WS1: the magic-link and social channels build their absolute,
  // localized Better Auth targets from this SAME value at click time
  // (`buildAuthRedirectTargets`); a failure returns here with `?from=` kept.
  const {
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
  } = useLoginFlows({
    postLoginTarget: resolvedPostLoginTarget,
  });

  // Error shake on the „Kontynuuj" button when login returns an error (empty/wrong e-mail or a
  // server rejection) — the reusable ButtonAtom `shake`.
  const [shake, setShake] = useState(false);
  useEffect(() => {
    if (error != null) {
      setShake(true);
    }
  }, [error]);

  // DECISION: login is FIRST-CLASS on desktop for everyone (owner decision, web-login-first); the
  // old "desktop plain visitor bounces to /get-app" is lifted. /user/login is an ACCOUNT route, so
  // useAppEntryModeForRoute(USER_LOG) returns 'app' for every visitor (account routes are exempt
  // from the get-app bounce in route-access.policy). The PRODUCT zone keeps its mobile-only desktop
  // bounce via the desktop-access cascade in AppLayout. Magic-link clicks never land here (the
  // ?authCode exchange lands on the callbackURL).

  // ---------------------------------------------------------------------------
  // Render — magic link sent confirmation
  // ---------------------------------------------------------------------------

  // Only after the server asked for it (risk signal on the send); see useLoginFlows.
  const turnstile = turnstileRequired ? (
    <TurnstileWidgetAtom
      onToken={handleTurnstileToken}
      resetNonce={turnstileResetNonce}
    />
  ) : null;

  if (magicLinkSent) {
    return (
      <MagicLinkSentMolecule
        email={email}
        registerIntent={registerIntent}
        onResend={() => void handleResend()}
        onChangeEmail={handleChangeEmail}
        resendStatus={resendStatus}
        resendError={resendError}
        turnstile={turnstile}
        t={t}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // Render — login form
  // ---------------------------------------------------------------------------

  return (
    <div className={styles.wrapper}>
      {/* Prominent, above-the-card escape hatch: the return-home link used to be a tiny
       * caption buried in the bottom secondary row (owner: "felt trapped, had to read
       * everything to find the way back"). A visible back-link at the top removes it. */}
      <div className={styles.homeReturn}>
        {nativeAuthReturn ? (
          /* A browser tab opened by the app for the duration of provider login: going back leads
                     nowhere here (the app stayed in the background), so we give an explicit jump back via the
                     `nailfolio://` scheme. A plain <a>, not next/link — it is an address outside the web app. */
          <a
            href={`${PLATFORM_CONFIG.DEEP_LINK_SCHEME}app`}
            className={styles.homeReturnLink}>
            <ArrowLeftIcon
              size={16}
              weight='bold'
              className={styles.homeReturnIcon}
              aria-hidden='true'
            />
            <span>{t('backToApp')}</span>
          </a>
        ) : (
          <Link href={ROUTES_FRONT.HOME} className={styles.homeReturnLink}>
            <ArrowLeftIcon
              size={16}
              weight='bold'
              className={styles.homeReturnIcon}
              aria-hidden='true'
            />
            <span>{t('backToHome')}</span>
          </Link>
        )}
      </div>

      <div className={styles.card}>
        {/* Brand header — the same lockup as the navbar (mark + Marcellus „Nailfolio"), then the
                    contextual h1 (login / signup). No brand-name pill. */}
        <div className={styles.logoSection}>
          <BrandLockupMolecule
            className={styles.brandLockup}
            markClassName={styles.brandMark}
          />
          <h1
            className={styles.headline}
            style={{ visibility: router.isReady ? undefined : 'hidden' }}
            aria-hidden={!router.isReady}>
            {registerIntent
              ? t('registerTitle')
              : recoveryContext
                ? t('recoverAccount')
                : t('subtitle')}
          </h1>
          {recoveryContext && (
            <p className={styles.subtitle}>{t('recoverSubtitle')}</p>
          )}
        </div>

        {/* Plan-aware funnel banner — only when the visitor arrived
            from /pricing with a chosen plan. Encouraging, plan-named copy via
            i18n (pages.login.planAwareBanner) — never hardcoded. */}
        {planBannerName !== null && (
          /* Clickable (owner): back to /pricing and scroll straight to the plans section (#pricing-plans),
             so the user can change their mind about the plan without searching. connectBanner (below)
             stays a <p> (pairing, does not lead to the pricing page). */
          <Link
            href={`${ROUTES_FRONT.PRICING}#pricing-plans`}
            className={`${styles.planBanner} ${styles.planBannerLink}`}>
            {t.rich('planAwareBanner', {
              plan: () => (
                <strong className={styles.planBannerName}>
                  {planBannerName}
                </strong>
              ),
            })}
          </Link>
        )}

        {/* Pairing-context banner — only when arriving from a stylist
            profile and not already in the plan funnel (mutually exclusive
            entry points). Reuses the planBanner style (same contextual role). */}
        {fromStylistProfile && planBannerName === null && (
          <p className={styles.planBanner}>
            {t(fromProfileMessage ? 'messageBanner' : 'connectBanner')}
          </p>
        )}

        {authErrorKey !== null && (
          <p className={styles.authErrorBanner} role='alert'>
            <span className={styles.authErrorIcon} aria-hidden='true'>
              <WarningCircleIcon size={20} weight='fill' />
            </span>
            <span>{t(`authError.${authErrorKey}`)}</span>
          </p>
        )}

        {/* DECISION: DEVELOPMENT hides BOTH real login channels (providers + magic link) and
            leaves only Quick Login (owner), because neither works locally and both
            only confuse. Magic link: the dev-sink (web-1 email-dev-sink.ts) ALWAYS stubs the
            resend/smtp transport, so no mail leaves, and even with DEV_EMAIL_FORCE_LIVE=true
            the click lands in a browser, not the wrapper WebView
            (NATIVE_DEEPLINK_ENABLED=false, no App Links for the dev domain). Providers
            (Google): the dev redirect URI is often unregistered and returning through an
            external browser loses the app WebView. Dev-login is the ONLY channel that stamps
            the token in the same browser context. STAGING/PREVIEW/PRODUCTION render the full
            set; the branch is purely presentational (the backend channel gates stay). */}
        {/* DECISION: the field and one action carry this step. Link instructions belong to
            the sent state, not a paragraph before submitting. (owner) */}
        {!isDev && (
          <>
            <form
              className={styles.form}
              onSubmit={e => void handleMagicLinkSubmit(e)}
              noValidate>
              {/* enterKeyHint='send' — mobile keyboard shows "Send" action key */}
              <InputAtom
                ref={emailInputRef}
                label={t('emailLabel')}
                type='email'
                placeholder={t('emailPlaceholder')}
                value={email}
                onChange={handleEmailChange}
                disabled={isSubmitting}
                autoComplete='email'
                inputMode='email'
                autoCapitalize='none'
                autoCorrect='off'
                spellCheck={false}
                aria-required='true'
                enterKeyHint='send'
                {...(error != null ? { error } : {})}
              />
              {turnstile}

              <ButtonAtom
                type='submit'
                variant='primary'
                size='lg'
                className={`${styles.submitButton} press-feedback`}
                loading={isSubmitting}
                shake={shake}
                onShakeEnd={() => setShake(false)}>
                {isSubmitting
                  ? t('sending')
                  : registerIntent
                    ? t('registerContinue')
                    : t('continue')}
              </ButtonAtom>
            </form>

            <LoginAlternativesMolecule
              oauthEnabled={oauthEnabled}
              socialLoading={socialLoading}
              onSocialSignIn={provider => void handleSocialSignIn(provider)}
              t={t}
            />
          </>
        )}

        {/* DEVELOPMENT only: Quick Login panel (backend dev-login is DEV-only gated) */}
        {isDev && (
          <QuickLoginPanelMolecule
            isSubmitting={isSubmitting}
            onQuickLogin={tile => void handleQuickLogin(tile)}
            t={t}
          />
        )}
      </div>

      {/* Account recovery and help. In the magic-link model
          there is no "forgot password"; recovery of a closed account is the
          closest equivalent. Owner: these were bare grey words
          under the form that read as static text; they are links, so they are
          rows (the product's one tappable-row primitive) under the card. */}
      <div className={styles.secondaryNav}>
        <DisclosureMolecule title={t('moreOptions')} surface='plain'>
          <NavRowListMolecule ariaLabel={t('moreOptions')}>
            {/* The row leads to THIS screen in its recovery framing, not to the
              recovery page: that one needs a session, and an anonymous visitor
              sent there came straight back here with nothing explained. */}
            {!recoveryContext && (
              <NavRowMolecule
                href={`${ROUTES_FRONT.USER_LOG}?from=${encodeURIComponent(ROUTES_FRONT.USER_RECOVER)}`}
                label={t('recoverAccount')}
                trailing='chevron'
              />
            )}
            <NavRowMolecule
              href={ROUTES_FRONT.HELP_CENTER}
              label={t('helpCenter')}
              trailing='chevron'
            />
          </NavRowListMolecule>
        </DisclosureMolecule>
      </div>
    </div>
  );
}
