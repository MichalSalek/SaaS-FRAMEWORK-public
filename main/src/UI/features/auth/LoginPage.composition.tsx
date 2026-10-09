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
  SocialLoginSectionMolecule,
} from './LoginPage.parts.molecule';
import { QuickLoginPanelMolecule } from './LoginPage.quickLogin.molecule';
import { readPrefilledRole } from './onboarding.helpers';
import {
  resolvePostLoginTarget,
  isRegisterIntent,
  resolvePlanBannerName,
  isFromStylistProfile,
  resolveAuthErrorKey,
  isNativeAuthReturn,
} from './LoginPage.helpers';
import { resolveLocalizedReturnPath } from '../../../application/auth/post-login-return';
import { useLoginFlows } from './useLoginFlows';
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

  // DD2-D7: capture the originally-requested URL from `?from=...` so we can
  // deliver the user back after login.
  const postLoginTarget = resolvePostLoginTarget(router.query['from']);

  // Wave F (F1-01): switch to registration-oriented copy when a marketing CTA
  // links here with `?intent=register`.
  const registerIntent = isRegisterIntent(router.query['intent']);

  // S62: a guest who tapped a client-only action on a public stylist profile
  // ("Poproś o połączenie" / bookmark) lands here with `?from=/stylist/<id>`.
  // The generic stylist-oriented header ("…dla stylistek paznokci") loses the
  // pairing context, so surface a short banner naming their real intent.
  const fromStylistProfile = isFromStylistProfile(router.query['from']);

  // H-FUNNEL-1/2: a marketing CTA can carry ?role=stylist|client (UX hint only).
  // When present, point the magic-link callback straight at onboarding with the
  // role pre-selected — this revives the previously starved readPrefilledRole /
  // rolePrefilledHint path (nothing upstream fed ?role into /app/onboarding before).
  // SECURITY: the URL role only pre-selects a *changeable* onboarding radio; the
  // authoritative account type is created from the submitted form + session, never
  // from this param. readPrefilledRole validates strictly to 'stylist' | 'client'.
  const prefilledRole = readPrefilledRole(router.query);

  // Nieudane logowanie przez dostawcę wraca tutaj z kodem w adresie
  // (`?error=…`, doklejany przez Better Auth). Bez odczytania go ekran wygląda
  // tak, jakby nic się nie stało, a użytkownik nie wie, czy kliknął źle, czy
  // aplikacja go odrzuciła (incydent 2026-08-17). `nativeAuth=1` dokłada
  // informację, że siedzimy w zewnętrznej przeglądarce otwartej przez aplikację.
  const authErrorKey = resolveAuthErrorKey(router.query['error']);
  const nativeAuthReturn = isNativeAuthReturn(router.query['nativeAuth']);

  // Wave W3 (web-login-first): a /pricing CTA carries the chosen plan via
  // `?planId=&billingPeriod=` (hybrid precedence: query > sessionStorage). When
  // a plan intent is present, this is a NEW-account funnel — point post-login at
  // onboarding (account creation) rather than the generic dashboard/pay deep-link,
  // and persist the choice to sessionStorage so it survives the magic-link
  // round-trip (Better Auth fixes the callbackURL, not arbitrary funnel state).
  // The pay surface (Wave W2) reads + clears the funnel on consumption.
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
  // Kontekst connect-z-profilu WYGRYWA ze stale funnel-intent (S76): visitor,
  // który wcześniej kliknął CTA planu, a potem wszedł na profil stylistki
  // „poproś o połączenie", przychodzi tu jako KLIENTKA — banner „Wybrałaś plan
  // Pro" obok connect-kontekstu to sprzeczny przekaz (klientka nie kupuje
  // planu). Priorytet lustrzany do subtitle niżej (registerIntent > connect >
  // default). Funnel state w sessionStorage zostaje nietknięty — stylistka
  // wracająca do rejestracji nadal dostanie swój plan.
  const planBannerName =
    mounted && !fromStylistProfile
      ? resolvePlanBannerName(pricingFunnel?.planId)
      : null;
  // Persist the resolved choice so it survives the magic-link round-trip.
  // Depend on the PRIMITIVE planId/billingPeriod (not the freshly-built object,
  // which has a new identity every render) so the write fires only when the
  // actual choice changes — idempotent re-writes of the same value are avoided.
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
  // D6: Better Auth gets the SAME target with the login page's locale prefix
  // (`/en/app/onboarding?role=stylist`), for magic-link AND social sign-in; the
  // failure exit is the localized login screen (`?error=` is read above).
  const magicLinkCallback = resolveLocalizedReturnPath({
    path: resolvedPostLoginTarget,
    locale: router.locale,
    defaultLocale: router.defaultLocale,
  });
  const errorCallback = resolveLocalizedReturnPath({
    path: ROUTES_FRONT.USER_LOG,
    locale: router.locale,
    defaultLocale: router.defaultLocale,
  });

  const {
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
  } = useLoginFlows({
    magicLinkCallback,
    errorCallback,
    postLoginTarget: resolvedPostLoginTarget,
  });

  // Error-shake na przycisku „Kontynuuj" gdy logowanie zwróci błąd (pusty/zły
  // email lub odrzucenie serwera) — reużywalny ButtonAtom `shake`.
  const [shake, setShake] = useState(false);
  useEffect(() => {
    if (error != null) {
      setShake(true);
    }
  }, [error]);

  // DECISION (nie usuwaj tego komentarza):
  // Wave W3 (web-login-first): login is now FIRST-CLASS on desktop for EVERYONE
  // (owner decision) — the previous "desktop PREVIEW/PROD plain visitor → bounce
  // to /get-app" is LIFTED. /user/login is an ACCOUNT route, so
  // useAppEntryModeForRoute(USER_LOG) returns 'app' for every visitor (account
  // routes are exempt from the get-app bounce in route-access.policy). The
  // PRODUCT zone (galleries/feed/dashboard) keeps its mobile-only desktop bounce
  // via the unchanged desktop-access cascade in AppLayout. With no redirect, the
  // former isSessionPending / magicLinkSent guards and the up-front /get-app
  // navigation are gone. Magic-link clicks were always unaffected (the ?authCode
  // exchange lands on the callbackURL, never here).

  // ---------------------------------------------------------------------------
  // Render — magic link sent confirmation
  // ---------------------------------------------------------------------------

  if (magicLinkSent) {
    return (
      <MagicLinkSentMolecule
        email={email}
        onResend={() => void handleResend()}
        onChangeEmail={handleChangeEmail}
        resendStatus={resendStatus}
        resendError={resendError}
        t={t}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // Render — login form
  // ---------------------------------------------------------------------------

  return (
    <div className={styles.wrapper}>
      {/* Prominent, above-the-card escape hatch — the return-home link used to
       * be a tiny caption buried in the bottom secondary row (owner: „poczucie
       * uwięzienia, trzeba wszystko przeczytać, żeby znaleźć powrót"). A visible
       * back-link at the top removes the trapped feeling. */}
      <div className={styles.homeReturn}>
        {nativeAuthReturn ? (
          /* Karta przeglądarki otwarta przez aplikację na czas logowania
           * dostawcą: cofanie prowadzi tu donikąd (aplikacja została w tle),
           * więc dajemy jawny skok z powrotem przez schemat `nailfolio://`.
           * Zwykły <a>, nie next/link — to adres poza aplikacją webową. */
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
        {/* Brand header — ten sam lockup co navbar (sygnet + Marcellus
            „Nailfolio"), potem kontekstowy h1 (logowanie / rejestracja).
            Zero pastylki z nazwą marki (S88). */}
        <div className={styles.logoSection}>
          <BrandLockupMolecule
            className={styles.brandLockup}
            markClassName={styles.brandMark}
          />
          <h1 className={styles.headline}>
            {registerIntent ? t('registerTitle') : t('subtitle')}
          </h1>
          {/* S65: the default subtitle positions Nailfolio "for nail stylists",
              which mismatches a CLIENT who arrived from a stylist profile to
              connect. Swap in client-value copy (connectSubtitle) in that case —
              the connectBanner below carries the pairing action, so the two are
              complementary, not duplicated. registerIntent (marketing signup)
              still wins; the entry points are mutually exclusive in practice. */}
          <p className={styles.subtitle}>
            {registerIntent
              ? t('registerSubtitle')
              : fromStylistProfile
                ? t('connectSubtitle')
                : t('subtitle2')}
          </p>
        </div>

        {/* Wave W3: plan-aware funnel banner — only when the visitor arrived
            from /pricing with a chosen plan. Encouraging, plan-named copy via
            i18n (pages.login.planAwareBanner) — never hardcoded. */}
        {planBannerName !== null && (
          /* Klikalny (owner S82): wróć na /pricing i zescrolluj wprost do
             sekcji planów (#pricing-plans) — user zmienia zdanie o planie
             bez szukania. connectBanner (niżej) zostaje <p> (pairing, nie
             prowadzi do cennika). */
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

        {/* S62: pairing-context banner — only when arriving from a stylist
            profile and not already in the plan funnel (mutually exclusive
            entry points). Reuses the planBanner style (same contextual role). */}
        {fromStylistProfile && planBannerName === null && (
          <p className={styles.planBanner}>{t('connectBanner')}</p>
        )}

        {authErrorKey !== null && (
          <p className={styles.authErrorBanner} role='alert'>
            <span className={styles.authErrorIcon} aria-hidden='true'>
              <WarningCircleIcon size={20} weight='fill' />
            </span>
            <span>{t(`authError.${authErrorKey}`)}</span>
          </p>
        )}

        {/* DECISION (nie usuwaj tego komentarza):
            DEVELOPMENT ukrywa OBA realne kanały logowania (dostawcy + magic
            link), zostawiając wyłącznie Quick Login — decyzja ownera
            2026-08-31, bo żaden z nich nie DZIAŁA lokalnie i oba tylko mylą:
            • magic link: dev-sink (web-1 email-dev-sink.ts) ZAWSZE stubuje
              transport resend/smtp, więc mail nigdy nie wychodzi; a nawet z
              DEV_EMAIL_FORCE_LIVE=true klik w mailu ląduje w przeglądarce, nie
              w WebView wrappera (NATIVE_DEEPLINK_ENABLED=false + brak App
              Links dla domeny dev).
            • dostawcy (Google): redirect URI dev bywa niezarejestrowane, a
              powrót przez zewnętrzną przeglądarkę gubi WebView apki.
            Dev-login (Quick Login) jest JEDYNYM kanałem, który stempluje token
            w tym samym kontekście przeglądarki — więc jest jedynym pokazywanym.
            STAGING/PREVIEW/PRODUCTION renderują pełny zestaw bez zmian; gałąź
            jest czysto prezentacyjna (backendowe gate'y kanałów zostają). */}
        {/* DECISION (nie usuwaj tego komentarza) — owner 2026-10-08:
            jedno pole, JEDNA wypełniona akcja („Kontynuuj”), a dostawcy pod
            spodem jako `outlined` tej samej wysokości. Wcześniej Google stał
            NAD polem e-mail i konkurował z nim o pierwszeństwo. Zdanie
            „logujesz się linkiem, bez hasła” stoi pod przyciskiem zawsze,
            bo tłumaczy, co zrobi „Kontynuuj” (dotąd tylko bez dostawców). */}
        {!isDev && (
          <>
            <form
              className={styles.form}
              onSubmit={e => void handleMagicLinkSubmit(e)}
              noValidate>
              {/* F1-11: enterKeyHint='send' — mobile keyboard shows "Send" action key */}
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

              <ButtonAtom
                type='submit'
                variant='primary'
                size='lg'
                className={`${styles.submitButton} haptic-press`}
                loading={isSubmitting}
                shake={shake}
                onShakeEnd={() => setShake(false)}>
                {isSubmitting ? t('sending') : t('continue')}
              </ButtonAtom>
              <p className={styles.reassureLine}>{t('emailReassurance')}</p>
            </form>

            {oauthEnabled && (
              <SocialLoginSectionMolecule
                socialLoading={socialLoading}
                onSocialSignIn={provider => void handleSocialSignIn(provider)}
                t={t}
              />
            )}
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

      {/* F1-07 / AUTH-07: account recovery and help. In the magic-link model
          there is no "forgot password"; recovery of a closed account is the
          closest equivalent. Owner 2026-10-08: these were bare grey words
          under the form that read as static text; they are links, so they are
          rows (the product's one tappable-row primitive) under the card. */}
      <div className={styles.secondaryNav}>
        <NavRowListMolecule ariaLabel={t('moreOptions')}>
          <NavRowMolecule
            href={ROUTES_FRONT.USER_RECOVER}
            label={t('recoverAccount')}
            trailing='chevron'
          />
          <NavRowMolecule
            href={ROUTES_FRONT.HELP_CENTER}
            label={t('helpCenter')}
            trailing='chevron'
          />
        </NavRowListMolecule>
      </div>
    </div>
  );
}
