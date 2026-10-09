// main/src/application/lifecycle/AppLifecycle.tsx
// Application lifecycle: one-time initialization tasks that run on mount.
//
// Pattern: React component wrapper with useEffect (empty deps = run once on mount).

import { useEffect, useRef, type ReactNode } from 'react';
import { initCapacitorOnlineManager } from '../http/capacitor-online-manager';
import { initNativeLoginDeepLinkListener } from '../auth/native-deeplink-listener';
import { initHapticPressListener } from '../platform/haptic-press-listener';
import { onAppStateChange } from '../platform/app-state';
import { initStatusBarTheming } from '../platform/status-bar';
import { authClient } from '../auth/better-auth-client';
import { queryClient } from '../http/queryClient.config';
import { queryKeys } from '../http/queryKeys.factory';
import { reportIssueFrontend } from '../error-debugger/errorHandler.possibilities.api';
import { isNonActionableClientNoise } from '../error-debugger/error-noise-filter';
import { useNavigationStore } from '../stores/navigation.store';

interface AppLifecycleProps {
  children: ReactNode;
}

/**
 * AppLifecycle — wraps the app tree and runs one-time side-effects on mount.
 *
 * Current responsibilities:
 *   1. Initialize Capacitor online manager (native: Network plugin, web: no-op fallback)
 *   2. Hide Capacitor splash screen after hydration (native only)
 *   3. Handle Android hardware back button (native only)
 *   4. Configure iOS keyboard behavior (native only)
 *   5. Global haptic feedback for .haptic-press elements (native only)
 *   6. App state change listener — fires on resume from background (native only)
 *   7. Global unhandledrejection + window.error handlers — forward uncaught
 *      errors to the EventLog so silent failures stop being invisible.
 *   8. Login deep-link receiver (native only) — warm-start magic-link taps and
 *      nailfolio:// OAuth returns land here, NOT in the wrapper shell (its
 *      listener died when the WebView navigated to this app).
 *   9. Status bar theming (native only) — icon polarity follows the live palette
 *      and reacts to theme switches. The background colour is best-effort:
 *      Android 15+ (edge-to-edge) ignores it, measured — see the DECISION in
 *      `platform/status-bar.ts`.
 */
export function AppLifecycle({ children }: AppLifecycleProps) {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (initializedRef.current) {
      return;
    }
    initializedRef.current = true;

    // 1. Capacitor Network <-> TanStack Query online manager integration
    void initCapacitorOnlineManager();

    // 2. Hide splash screen (native: wrapper holds splash until this call)
    void hideSplashScreen();

    // 3. Android back button handler
    void initBackButtonHandler();

    // 4. iOS keyboard (push content up instead of overlaying)
    void initKeyboardBehavior();

    // 5. Haptic feedback for all .haptic-press elements
    initHapticPressListener();

    // 6. App resume — refresh auth token
    void onAppStateChange(({ isActive }) => {
      if (isActive) {
        void refreshSessionOnResume();
      }
    });

    // 8. Warm-start login deep links (magic-link / native OAuth return)
    void initNativeLoginDeepLinkListener();
  }, []);

  // 9. Pasek statusu skorupy natywnej pod żywą paletę — osobny efekt, bo ma
  // własny cleanup (MutationObserver na data-mode musi zniknąć z komponentem).
  useEffect(() => initStatusBarTheming(), []);

  // 7. Global error sinks — separate effect with its own cleanup so the
  // listeners are detached on unmount (mainly HMR / Strict Mode double-mount
  // safety; in production AppLifecycle lives for the whole session).
  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const onUnhandledRejection = (evt: PromiseRejectionEvent) => {
      const reason = evt.reason;
      const isError = reason instanceof Error;
      const namespace = 'unhandledrejection';
      const message = isError ? reason.message : String(reason);
      const payload = {
        stack: isError ? (reason.stack ?? null) : null,
        name: isError ? reason.name : typeof reason,
      };
      // Skip provably-non-actionable client noise (extension-injected
      // rejections) — never reaches the backend AppLogRecord store. A real
      // rejection carries its own message/stack and is reported normally.
      if (isNonActionableClientNoise({ namespace, message, payload })) {
        return;
      }
      const isOfflineFetch = message === 'A network error occurred.';
      reportIssueFrontend({
        namespace,
        message,
        payload,
        mode: isOfflineFetch ? 'warn' : 'error',
      });
    };

    const onError = (evt: ErrorEvent) => {
      const namespace = 'window.error';
      const message = evt.message;
      const payload = {
        filename: evt.filename,
        lineno: evt.lineno,
        colno: evt.colno,
        stack: evt.error instanceof Error ? (evt.error.stack ?? null) : null,
      };
      // Skip provably-non-actionable client noise (bare cross-origin "Script
      // error." with no filename/stack) — a genuine same-origin error keeps its
      // filename+stack and is reported.
      if (isNonActionableClientNoise({ namespace, message, payload })) {
        return;
      }
      reportIssueFrontend({ namespace, message, payload, mode: 'error' });
    };

    window.addEventListener('unhandledrejection', onUnhandledRejection);
    window.addEventListener('error', onError);
    return () => {
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      window.removeEventListener('error', onError);
    };
  }, []);

  return <>{children}</>;
}

async function hideSplashScreen(): Promise<void> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch {
    // Web or plugin not available — no-op
  }
}

async function initKeyboardBehavior(): Promise<void> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    const { Keyboard, KeyboardResize } = await import('@capacitor/keyboard');
    await Keyboard.setResizeMode({ mode: KeyboardResize.Ionic });
    await Keyboard.setScroll({ isDisabled: false });
  } catch {
    // Web or plugin not available — no-op
  }
}

// DECISION (nie usuwaj tego komentarza):
// refreshSessionOnResume jest zwykłą module-level async function (poza React
// scope) — nie może wywołać useSession() ani destructuryzować refetch().
// Dlatego używamy authClient.getSession() (imperative proxy) zamiast reactive
// refetch(). Konsekwencja: getSession() NIE aktualizuje reactive atomu
// useSession() w better-auth 1.6.3 (ścieżka /get-session jest poza matcherem
// $sessionSignal atomListeners w client/config.mjs; value.set() jest wywoływane
// tylko przez refetch() w client/query.mjs). Atom self-heals przy najbliższym
// naturalnym BA focus-refetch lub nawigacji — low impact dla flow resume
// (rola odświeża się przy następnej interakcji). Pełny reactive refresh
// wymagałby przekazania refetch-refa z komponentu do handlera — większa
// przebudowa nieuzasadniona dla LOW-priority site. invalidateQueries pokrywa
// stale profile data (D1-F9). Nie zmieniaj getSession() tu bez przeniesienia
// logiki do hooka z dostępem do useSession().
async function refreshSessionOnResume(): Promise<void> {
  try {
    await authClient.getSession();
    // D1-F9: after re-hydrating the Better Auth session, invalidate the TQ
    // currentUser cache so stale profile/account data from before the background
    // pause is flushed. Without this, the app resumes with up-to-60s stale data
    // (staleTime = 60_000) — plan changes, account state etc. won't reflect until
    // the next natural refetch.
    void queryClient.invalidateQueries({ queryKey: queryKeys.account.current });
  } catch {
    // Token expired or network down — user will be redirected on next protected action
  }
}

async function initBackButtonHandler(): Promise<void> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    const { App } = await import('@capacitor/app');
    await App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) {
        // Route the hardware back through the unified FSM-aware back()
        // (registered by NavigationTransitionController) so a hardware press
        // animates like in-app back. getState() is a legal imperative read
        // outside React (same pattern as the snackbar store). Falls back to a
        // raw history pop if the controller has not mounted yet (defensive —
        // should not happen once the app tree is alive).
        const triggerBack = useNavigationStore.getState().triggerBack;
        if (triggerBack) {
          triggerBack();
        } else {
          window.history.back();
        }
      } else {
        void App.minimizeApp();
      }
    });
  } catch {
    // Web or plugin not available — no-op
  }
}
