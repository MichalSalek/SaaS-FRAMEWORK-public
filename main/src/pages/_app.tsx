import { useCallback, type ReactNode } from 'react';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import type { AppProps } from 'next/app';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { I18N_CONFIG } from '@kernel/domain/i18n/i18n.config';
import { queryClient } from '../application/http/queryClient.config';
// Side-effect: registers the global mutation-error snackbar fallback on the
// queryClient's MutationCache. Kept as a separate wiring module to avoid a
// value↔value import cycle in queryClient.config (see that file's DECISION).
import '../application/http/queryClient.errorWiring';
import { AuthProviderComposition } from '../UI/contexts/AuthContext.composition';
import { LoginConfirmGateComposition } from '../UI/features/auth/LoginConfirmGate.composition';
import { ThemeProviderComposition } from '../UI/styles/ThemeContext.composition';
import { AppLifecycle } from '../application/lifecycle/AppLifecycle';
import { ErrorBoundaryComposition } from '../UI/components/ErrorBoundary.composition';
import { AppDynamicMenuContext } from '../application/app-dynamic-menu/appDynamicMenu.context';
import { useAppDynamicMenuContext } from '../application/app-dynamic-menu/useAppDynamicMenuContext.hook';
import { AppSnackbarsController } from '../application/app-snackbar/sonner-adapter/AppSnackbars.controller';
import { NavigationTransitionControllerComposition } from '../UI/layouts/NavigationTransitionController.composition';
import { LeaveGuardDialogComposition } from '../UI/layouts/LeaveGuardDialog.composition';
import { CookieBannerOrganism } from '../UI/components/CookieBanner/CookieBanner.organism';
import { VerboseLogSyncComposition } from '../UI/features/maintenance/VerboseLogSync.composition';
import { MaintenanceGateComposition } from '../UI/features/maintenance/MaintenanceGate.composition';
import { AnalyticsScripts } from '../application/analytics/AnalyticsScripts';
import { PostHogIdentifyBridge } from '../application/analytics/PostHogIdentifyBridge';
import { PostHogProvider } from '../application/analytics/PostHogProvider';
import '../UI/styles/global.css';
// Definicje fontów: application/fonts.ts (klasy zmiennych trafiają też na <html>
// w _document, żeby widziały je portale i dziedziczenie z <body>).
import { FONT_VARIABLE_CLASSNAMES } from '../application/fonts';

// A1-F4: Lazy-load ImpersonationBanner — admin-only component that renders null
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
 * D1-F1: onReset calls queryClient.resetQueries() to clear stale/errored cache
 * entries — prevents the boundary from re-throwing immediately after reset.
 * D1-F2: fallbackHomeAction renders a "Back to home" button as an escape hatch
 * when re-mounting alone cannot recover (e.g. corrupted upstream state).
 */
function I18nErrorBoundary({ children }: { children: ReactNode }) {
  const t = useTranslations('errors');
  const qc = useQueryClient();
  const onReset = useCallback(() => {
    void qc.resetQueries();
  }, [qc]);
  return (
    <ErrorBoundaryComposition
      fallbackTitle={t('unexpectedError')}
      fallbackAction={t('tryAgain')}
      fallbackHomeAction={t('backToHome')}
      onReset={onReset}>
      {children}
    </ErrorBoundaryComposition>
  );
}

/**
 * Provider tree (MIG-F2):
 *
 *   QueryClientProvider          — TanStack Query cache
 *     AuthProvider               — Auth state (token, logout, becomeUser)
 *       ThemeProvider            — Palette + light/dark mode
 *         NextIntlClientProvider — i18n
 *          LoginConfirmGate      — s34: blocks the app on an unconfirmed ?authCode login
 *           AppLifecycle         — One-time init (Capacitor online manager, etc.)
 *             ErrorBoundary      — Catches render errors
 *               AppDynamicMenu   — Dynamic action buttons context
 *                 <Component />  — Page
 *                 AppSnackbarsController — Sonner Toaster (pushNewSnackbar)
 */
export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const dynamicMenuCtx = useAppDynamicMenuContext();

  return (
    /* DECISION (nie usuwaj tego komentarza):
     * Ten wrapper istnieje WYŁĄCZNIE po to, żeby `_app` pozostał issuerem
     * fontów w `next-font-manifest`. Renderer stron składa `<link rel=preload
     * as=font>` z wpisów `pages['/_app']` + `pages[trasa]`; `_document` nie jest
     * w tym zestawieniu. Gdy klasy zniknęły stąd do samego `<Html>`, manifest
     * wyszedł z buildu PUSTY i produkcyjny HTML miał ZERO preloadów fontów
     * (zmierzone na `.next/server/pages/pl/*.html`: 4 → 0), czyli FOUT na
     * pierwszym renderze. Zmienne są też na `<html>` — tam dla portali i
     * dziedziczenia z `<body>` — i ta redundancja jest celowa: dwie deklaracje
     * tych samych custom properties nic nie kosztują, brak preloadu kosztuje LCP. */
    <div className={FONT_VARIABLE_CLASSNAMES}>
      <Head>
        {/* Keep layout-sized streams above the Android browser keyboard. */}
        <meta
          name='viewport'
          content='width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content'
        />
      </Head>
      <QueryClientProvider client={queryClient}>
        <AuthProviderComposition>
          <ThemeProviderComposition>
            <NextIntlClientProvider
              locale={router.locale || 'pl'}
              messages={pageProps.messages}
              timeZone={I18N_CONFIG.timezone}>
              <LoginConfirmGateComposition>
                <AppLifecycle>
                  <I18nErrorBoundary>
                    <AppDynamicMenuContext.Provider value={dynamicMenuCtx}>
                      {/* ImpersonationBanner: sticky-top, mounted above all
                       * layouts so an admin sees the switch-back affordance
                       * on every page during a become-user session. Self-gated
                       * — renders null when no impersonation is active. */}
                      <ImpersonationBanner />
                      <Component {...pageProps} />
                      {/* NavigationTransitionController: render-null controller
                       * (NVT). The single subscriber of pages-router events —
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
                      <AnalyticsScripts />
                    </AppDynamicMenuContext.Provider>
                  </I18nErrorBoundary>
                </AppLifecycle>
              </LoginConfirmGateComposition>
            </NextIntlClientProvider>
          </ThemeProviderComposition>
        </AuthProviderComposition>
      </QueryClientProvider>
    </div>
  );
}
