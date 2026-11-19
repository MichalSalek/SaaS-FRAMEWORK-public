/**
 * Open external URLs in in-app browser (native) or new tab (web).
 * Prevents external links from breaking the Capacitor session.
 */

export interface OpenExternalUrlOptions {
  /**
   * Native-only: dismiss the opened tab once the app comes back to the foreground.
   *
   * The native OAuth flow opens the provider in an EXTERNAL tab (Google rejects
   * embedded WebViews) and returns via the `nailfolio://` custom scheme, which the
   * shell handles NATIVELY (MainActivity.onNewIntent) — @capacitor/browser is not
   * exposed on the remote frontend origin, so `Browser.open` throws and we fall back
   * to `window.open`. That leaves the spent OAuth tab orphaned: the scheme redirect
   * has no page left to self-close, and the tab's own JS can't be reached. To close
   * it we keep the window handle (open WITHOUT `noopener`) and dismiss it when the
   * shell re-navigates this WebView to `/app?authCode` on the OAuth return — the
   * `pagehide`/`unload` at that navigation is the exact, safe moment (it fires only
   * on the return, never on a mid-flow app-switch, so login is never cut short).
   * Cross-origin `.close()` on a script-opened window is permitted.
   */
  autoCloseOnReturn?: boolean;
}

// Handle of the last auto-close tab (the in-flight OAuth external tab). Module-level
// so the one-shot navigation listener can reach it after openExternalUrl returns.
let pendingAutoCloseWindow: Window | null = null;
let autoCloseListenerBound = false;

function closePendingAutoCloseWindow(): void {
  if (!pendingAutoCloseWindow) {
    return;
  }
  try {
    pendingAutoCloseWindow.close();
  } catch {
    // Cross-origin/already-closed — best-effort; login is unaffected either way.
  }
  pendingAutoCloseWindow = null;
}

function bindAutoCloseListenerOnce(): void {
  if (autoCloseListenerBound || typeof window === 'undefined') {
    return;
  }
  autoCloseListenerBound = true;
  // The shell navigates this WebView away (login → /app?authCode) on the OAuth
  // return; that is when the orphaned provider tab should go. `unload` is the most
  // reliably-fired page-teardown event inside an Android WebView; `pagehide` is the
  // modern counterpart — bind both, the close is idempotent.
  window.addEventListener('pagehide', closePendingAutoCloseWindow);
  window.addEventListener('unload', closePendingAutoCloseWindow);
}

export async function openExternalUrl(
  url: string,
  options?: OpenExternalUrlOptions
): Promise<void> {
  const autoCloseOnReturn = options?.autoCloseOnReturn ?? false;

  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url, presentationStyle: 'popover' });
      return;
    }
  } catch {
    // @capacitor/browser is not implemented on remote (allowNavigation) origins —
    // the plugin call throws there. Fall through to window.open.
  }

  if (autoCloseOnReturn) {
    // Keep the handle (no `noopener`) so the navigation listener can dismiss this
    // tab on the OAuth return. The opened origins are our own OAuth start + the
    // provider — trusted, so dropping `noopener` here carries no tabnabbing risk.
    const opened = window.open(url, '_blank');
    if (opened) {
      pendingAutoCloseWindow = opened;
      bindAutoCloseListenerOnce();
    }
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}
