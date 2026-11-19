// main/src/application/lifecycle/AppLifecycle.tsx
// Application lifecycle: one-time initialization tasks that run on mount.
//
// Pattern: React component wrapper with useEffect (empty deps = run once on mount).

import { useEffect, useRef, type ReactNode } from 'react';
import { initCapacitorOnlineManager } from '../http/capacitor-online-manager';
import { initNativeLoginDeepLinkListener } from '../auth/native-deeplink-listener';
import { onAppStateChange } from '../platform/app-state';
import { initStatusBarTheming } from '../platform/status-bar';
import { initScreenBrightness } from '../platform/screen-brightness';
import { authClient } from '../auth/better-auth-client';
import { queryClient } from '../http/queryClient.config';
import { queryKeys } from '../http/queryKeys.factory';
import { reportIssueFrontend } from '../error-debugger/errorHandler.possibilities.api';
import { isNonActionableClientNoise } from '../error-debugger/error-noise-filter';
import { useNavigationStore } from '../stores/navigation.store';
import { consumeNativeBack } from '../platform/native-back';
import { recoverFromChunkLoadFailure } from './chunk-load-recovery';
import { getDocumentBuildId } from './document-build';
import { onNativeStartupReady } from './native-startup';

interface AppLifecycleProps {
  children: ReactNode;
}

/**
 * AppLifecycle wraps the app tree and runs one-time side-effects on mount:
 *   1. Initialize Capacitor online manager (native: Network plugin, web: no-op fallback)
 *   2. Hide the Capacitor splash after hydration and native entry validation (native)
 *   3. Android hardware back button (native)
 *   4. iOS keyboard behavior (native)
 *   5. (no press haptic on purpose: haptics follow outcomes, `platform/haptic-events.config.ts`)
 *   6. App state change listener, fires on resume from background (native)
 *   7. Global unhandledrejection + window.error handlers, forwarded to the EventLog
 *   8. Login deep-link receiver (native): warm-start magic-link taps and nailfolio:// OAuth returns
 *      land here, not in the wrapper shell
 *   9. Status bar theming (native): icon polarity follows the live palette; the background colour is
 *      best-effort (Android 15+ edge-to-edge ignores it, see `platform/status-bar.ts`)
 */
export function AppLifecycle({ children }: AppLifecycleProps) {
  const initializedRef = useRef(false);

  useEffect(() => initScreenBrightness(), []);

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

    // 3. Android back button handler
    void initBackButtonHandler();

    // 4. iOS keyboard (push content up instead of overlaying)
    void initKeyboardBehavior();

    // 6. App resume — refresh auth token
    void onAppStateChange(({ isActive }) => {
      if (isActive) {
        void refreshSessionOnResume();
      }
    });

    // 8. Warm-start login deep links (magic-link / native OAuth return)
    void initNativeLoginDeepLinkListener();
  }, []);

  // The native wrapper holds its splash through remote page load. On a bare native entry,
  // NativeEntryBootstrap marks the root pending and releases it only after /app, /welcome, or the
  // retry screen has committed. Other routes keep the existing post-hydration handoff.
  useEffect(() => onNativeStartupReady(() => void hideSplashScreen()), []);

  // 9. Native-shell status bar follows the live palette. Separate effect because it has its own
  // cleanup (the data-mode MutationObserver must go away with the component).
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
      const buildId = getDocumentBuildId();
      const payload = {
        stack: isError ? (reason.stack ?? null) : null,
        name: isError ? reason.name : typeof reason,
        buildId,
      };
      // Skip provably-non-actionable client noise (extension-injected
      // rejections) — never reaches the backend AppLogRecord store. A real
      // rejection carries its own message/stack and is reported normally.
      if (isNonActionableClientNoise({ namespace, message, payload })) {
        return;
      }
      const isOfflineFetch = message === 'A network error occurred.';
      const chunkRecovery = recoverFromChunkLoadFailure({ message, buildId });
      reportIssueFrontend({
        namespace,
        message,
        payload: { ...payload, chunkRecovery },
        mode: isOfflineFetch || chunkRecovery === 'reloaded' ? 'warn' : 'error',
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
        buildId: getDocumentBuildId(),
      };
      // Skip provably-non-actionable client noise (bare cross-origin "Script
      // error." with no filename/stack) — a genuine same-origin error keeps its
      // filename+stack and is reported.
      if (isNonActionableClientNoise({ namespace, message, payload })) {
        return;
      }
      const chunkRecovery = recoverFromChunkLoadFailure({
        message,
        buildId: payload.buildId,
      });
      reportIssueFrontend({
        namespace,
        message,
        payload: { ...payload, chunkRecovery },
        mode: chunkRecovery === 'reloaded' ? 'warn' : 'error',
      });
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
    await SplashScreen.hide({ fadeOutDuration: 200 });
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
    // Capacitor Keyboard marks resize and scroll setters as iOS-only; Android
    // implements them as unimplemented plugin calls.
    if (Capacitor.getPlatform() !== 'ios') {
      return;
    }

    const { Keyboard, KeyboardResize } = await import('@capacitor/keyboard');
    await Keyboard.setResizeMode({ mode: KeyboardResize.Ionic });
    await Keyboard.setScroll({ isDisabled: false });
  } catch {
    // Web or plugin not available — no-op
  }
}

// DECISION: refreshSessionOnResume is a plain module-level async function (outside React), so it
// cannot call useSession() or destructure refetch(). It uses the imperative authClient.getSession()
// instead, which does NOT update the reactive useSession() atom (the /get-session path is outside
// the $sessionSignal matcher in better-auth's client/config; only refetch() in client/query sets
// the atom). The atom self-heals on the next natural focus-refetch or navigation, which is low
// impact for the resume flow; a full reactive refresh would need a refetch ref passed from a
// component, a rebuild not worth it here. invalidateQueries covers stale profile data. Do not
// change getSession() here without moving the logic into a hook with access to useSession().
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
      if (consumeNativeBack()) {
        return;
      }
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
