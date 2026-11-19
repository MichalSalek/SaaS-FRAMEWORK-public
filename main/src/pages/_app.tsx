import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ContactMessagesProviderComposition } from '../UI/shared/i18n/ContactMessagesProvider.composition';
import type { AppProps } from 'next/app';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { I18N_CONFIG } from '@kernel/domain/i18n/i18n.config';
import {
  createServerQueryClient,
  queryClient,
} from '../application/http/queryClient.config';
// Side-effect: registers the global mutation-error snackbar fallback on the
// queryClient's MutationCache. Kept as a separate wiring module to avoid a
// value↔value import cycle in queryClient.config (see that file's DECISION).
import '../application/http/queryClient.errorWiring';
import { AuthProviderComposition } from '../UI/contexts/AuthContext.composition';
import { LoginConfirmGateComposition } from '../UI/features/auth/LoginConfirmGate.composition';
import { ThemeProviderComposition } from '../UI/styles/ThemeContext.composition';
import { AppLifecycle } from '../application/lifecycle/AppLifecycle';
import { ErrorBoundaryComposition } from '../UI/components/ErrorBoundary.composition';
import { useErrorBoundaryCopy } from '../UI/components/useErrorBoundaryCopy';
import { recoverFromMissingMessages } from '../application/i18n/missing-messages-recovery';
import { AppDynamicMenuContext } from '../application/app-dynamic-menu/appDynamicMenu.context';
import { useAppDynamicMenuContext } from '../application/app-dynamic-menu/useAppDynamicMenuContext.hook';
import { AppSnackbarsController } from '../application/app-snackbar/sonner-adapter/AppSnackbars.controller';
import { NavigationTransitionControllerComposition } from '../UI/layouts/NavigationTransitionController.composition';
import { LeaveGuardDialogComposition } from '../UI/layouts/LeaveGuardDialog.composition';
import { CookieBannerOrganism } from '../UI/components/CookieBanner/CookieBanner.organism';
import { VerboseLogSyncComposition } from '../UI/features/maintenance/VerboseLogSync.composition';
import { MaintenanceGateComposition } from '../UI/features/maintenance/MaintenanceGate.composition';
import { NativeEntryBootstrapComposition } from '../UI/layouts/guards/NativeEntryBootstrap.composition';
import { AnalyticsScripts } from '../application/analytics/AnalyticsScripts';
import { EmailLifecycleBridgeComposition } from '../UI/contexts/EmailLifecycleBridge.composition';
import { captureLifecycleFromUrl } from '../application/analytics/email-lifecycle';
import { PostHogIdentifyBridge } from '../application/analytics/PostHogIdentifyBridge';
import { PostHogProvider } from '../application/analytics/PostHogProvider';
import { captureAnalyticsUrlStateFromUrl } from '../application/analytics/first-touch';
import { scrubRestoredAuthCodeFromUrl } from '../application/auth/auth-code.helpers';
import '../UI/styles/global.css';
// Font definitions: application/fonts.ts (the variable classes also go on <html> in _document so
// portals and inheritance from <body> see them).
import { FONT_VARIABLE_CLASSNAMES } from '../application/fonts';

// First-touch attribution and the internal-traffic flag are read from the URL
// before anything else runs. The one-time login code is NOT captured here: an
// early `replaceState` is undone by the router's own post-hydration query sync (the code comes
// back into the address and, when the exchange had already finished, stays there), so the code is
// scrubbed after the exchange in AuthContext.
if (typeof window !== 'undefined') {
  captureAnalyticsUrlStateFromUrl();
  captureLifecycleFromUrl();
}

// Lazy-load ImpersonationBanner — admin-only component that renders null
// for non-admins. Moving to dynamic({ ssr: false }) removes it from the _app
// bundle (~15-25 KB savings), deferring the chunk until it is actually needed.
const ImpersonationBanner = dynamic(
  () =>
    import('../UI/layouts/ImpersonationBanner.organism').then(
      m => m.ImpersonationBannerOrganism
    ),
  { ssr: false }
);

/**
 * Wrapper that injects i18n strings into the class-based ErrorBoundary
 * (class components cannot consume hooks). Must render inside NextIntlClientProvider.
 *
 * onReset calls queryClient.resetQueries() to clear stale/errored cache
 * entries — prevents the boundary from re-throwing immediately after reset.
 * fallbackHomeAction renders a "Back to home" button as an escape hatch
 * when re-mounting alone cannot recover (e.g. corrupted upstream state).
 */
function I18nErrorBoundary({ children }: { children: ReactNode }) {
  const copy = useErrorBoundaryCopy();
  const qc = useQueryClient();
  const onReset = useCallback(() => {
    void qc.resetQueries();
  }, [qc]);
  return (
    <ErrorBoundaryComposition
      fallbackTitle={copy.title}
      fallbackAction={copy.action}
      fallbackHomeAction={copy.home}
      onReset={onReset}>
      {children}
    </ErrorBoundaryComposition>
  );
}

/**
 * Provider tree:
 *
 *   QueryClientProvider          — TanStack Query cache
 *     AuthProvider               — Auth state (token, logout, becomeUser)
 *       ThemeProvider            — Palette + light/dark mode
 *         NextIntlClientProvider — i18n
 *          LoginConfirmGate      — blocks the app on an unconfirmed ?authCode login
 *           AppLifecycle         — One-time init (Capacitor online manager, etc.)
 *             ErrorBoundary      — Catches render errors
 *               AppDynamicMenu   — Dynamic action buttons context
 *                 <Component />  — Page
 *                 AppSnackbarsController — Sonner Toaster (pushNewSnackbar)
 */
export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  // Server: a fresh client per render; browser: the shared singleton
  // (DECISION at createServerQueryClient).
  const [requestQueryClient] = useState(() =>
    typeof window === 'undefined' ? createServerQueryClient() : queryClient
  );
  // The router's post-hydration query sync can put a consumed login code back
  // into the address; scrub it again once the router is ready (DECISION in
  // auth-code.helpers.ts).
  useEffect(() => {
    if (router.isReady) {
      scrubRestoredAuthCodeFromUrl();
    }
  }, [router.isReady]);
  // Every rendering page ships `messages` in its props (getStaticProps or
  // getServerSideProps). A client render without them got a bad data response;
  // recover with one document load (DECISION in missing-messages-recovery.ts).
  // Effects never run on the server, so the server render cannot reload.
  const messagesMissing = pageProps.messages === undefined;
  useEffect(() => {
    if (messagesMissing) {
      recoverFromMissingMessages({
        url: window.location.href,
        route: router.pathname,
      });
    }
  }, [messagesMissing, router.asPath, router.pathname]);
  const dynamicMenuCtx = useAppDynamicMenuContext();

  return (
    /* DECISION: this wrapper exists ONLY so `_app` stays the issuer of fonts in `next-font-manifest`.
     * The page renderer builds `<link rel=preload as=font>` from `pages['/_app']` + `pages[route]`;
     * `_document` is not in that set. When the classes moved to `<Html>` alone, the manifest came out
     * of the build EMPTY and production HTML had ZERO font preloads (FOUT on first render). The
     * variables are also on `<html>` (for portals and inheritance from `<body>`); the redundancy is
     * deliberate: two declarations of the same custom properties cost nothing, a missing preload
     * costs LCP. */
    <div className={FONT_VARIABLE_CLASSNAMES}>
      <Head>
        {/* Keep layout-sized streams above the Android browser keyboard. */}
        <meta
          name='viewport'
          content='width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content'
        />
      </Head>
      <QueryClientProvider client={requestQueryClient}>
        <AuthProviderComposition>
          <ThemeProviderComposition>
            <ContactMessagesProviderComposition
              locale={router.locale || 'pl'}
              messages={pageProps.messages}
              timeZone={I18N_CONFIG.timezone}>
              <LoginConfirmGateComposition>
                <AppLifecycle>
                  <I18nErrorBoundary>
                    <AppDynamicMenuContext.Provider value={dynamicMenuCtx}>
                      <NativeEntryBootstrapComposition>
                        {/* ImpersonationBanner: sticky-top, mounted above all
                         * layouts so an admin sees the switch-back affordance
                         * on every page during a become-user session. Self-gated
                         * — renders null when no impersonation is active. */}
                        <ImpersonationBanner />
                        <Component {...pageProps} />
                        {/* NavigationTransitionController: render-null controller
                         * The single subscriber of pages-router events —
                         * drives the transition FSM (navigation.store), writes
                         * html[data-nav-*], owns scroll/focus contract and the
                         * hardware-back bridge. Inside router + provider tree so
                         * it can use useRouter / the nav store. */}
                        <NavigationTransitionControllerComposition />
                        {/* Leave guard: the one "leave without saving?"
                         * dialog plus the router push/replace seam
                         * (useLeaveGuard; DECISION in leave-guard.ts). */}
                        <LeaveGuardDialogComposition />
                        <AppSnackbarsController />
                        <VerboseLogSyncComposition />
                        <MaintenanceGateComposition />
                        <CookieBannerOrganism />
                        <PostHogProvider />
                        <PostHogIdentifyBridge />
                        <EmailLifecycleBridgeComposition />
                        <AnalyticsScripts />
                      </NativeEntryBootstrapComposition>
                    </AppDynamicMenuContext.Provider>
                  </I18nErrorBoundary>
                </AppLifecycle>
              </LoginConfirmGateComposition>
            </ContactMessagesProviderComposition>
          </ThemeProviderComposition>
        </AuthProviderComposition>
      </QueryClientProvider>
    </div>
  );
}
