import {
  readBottomSurfaceHex,
  readTopSurfaceHex,
  statusBarStyleForHex,
  systemBarIconStyleForHex,
} from './status-bar.surface';
import type { StatusBarStyle } from './status-bar.surface';

/**
 * DECISION 6: Pixel 9 / Android 16, target SDK 36, remote WebView; measured 2026-10-30.
 * 1. Return Capacitor proxies inside a plain object: their catch-all properties are thenable.
 * 2. StatusBar.setStyle works: `DARK` means light icons; `LIGHT` means dark icons.
 * 3. Android 15+ ignores setBackgroundColor. NativeChrome paints inset backing; retain the
 *    legacy call for older Android. The wrapper owns physical spacing, including after rotation.
 * 4. Sample each viewport edge's nearest opaque page background; only then fall back to
 *    html `--color-bg-main`. Foreground controls do not define an inset surface.
 * 5. Keep this in application/: computed DOM styles, no React/UI import or data-mode inference.
 * 6. Initial proof: Welcome C #151411; public home #ffffff/#23211e with readable icons.
 * 7. Settled Welcome B: same #a6074f top and independent #fdfbf9/#151411 lower inset, including
 *    rotation. The PROD comparison established that the gesture inset also reveals the backing.
 */

/**
 * Native system insets matched independently to the top and bottom surfaces of the live page.
 * Android 15+ ignores StatusBar.setBackgroundColor because of enforced edge-to-edge; the
 * shell's NativeChrome bridge paints native inset backing without changing WebView layout.
 */
interface StatusBarPlugin {
  setStyle(options: { style: StatusBarStyle }): Promise<void>;
  setBackgroundColor(options: { color: string }): Promise<void>;
}

interface NativeChromePlugin {
  setStatusBarSurface(options: { color: string }): Promise<void>;
  setSystemBarSurfaces(options: {
    topColor: string;
    bottomColor: string;
    bottomIconStyle: 'light' | 'dark';
  }): Promise<void>;
}

interface NativeStatusBarPlugins {
  statusBar: StatusBarPlugin;
  nativeChrome: NativeChromePlugin | null;
}

/**
 * Capacitor plugin proxies answer every property, so returning one directly from an async
 * function makes it look thenable and the promise never settles. Always wrap the proxies.
 */
async function resolveStatusBarPlugins(): Promise<NativeStatusBarPlugins | null> {
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core');
    if (
      !Capacitor.isNativePlatform() ||
      !Capacitor.isPluginAvailable('StatusBar')
    ) {
      return null;
    }

    return {
      statusBar: registerPlugin<StatusBarPlugin>('StatusBar'),
      nativeChrome: Capacitor.isPluginAvailable('NativeChrome')
        ? registerPlugin<NativeChromePlugin>('NativeChrome')
        : null,
    };
  } catch {
    return null;
  }
}

async function applyStatusBarSurface(
  plugins: NativeStatusBarPlugins,
  topColor: string,
  bottomColor: string,
  topChanged: boolean
): Promise<void> {
  if (topChanged) {
    try {
      await plugins.statusBar.setStyle({
        style: statusBarStyleForHex(topColor),
      });
    } catch {
      // The status bar is an enhancement: no reaction from the system breaks nothing.
    }

    try {
      // Best-effort compatibility path for Android 14 and earlier.
      await plugins.statusBar.setBackgroundColor({ color: topColor });
    } catch {
      // The plugin can be available without implementing this optional behavior.
    }
  }

  if (plugins.nativeChrome == null) {
    return;
  }

  try {
    await plugins.nativeChrome.setSystemBarSurfaces({
      topColor,
      bottomColor,
      bottomIconStyle: systemBarIconStyleForHex(bottomColor),
    });
  } catch {
    // Older wrappers expose only the one-color API; keep their existing top-surface behavior.
    try {
      await plugins.nativeChrome.setStatusBarSurface({ color: topColor });
    } catch {
      // An unavailable native enhancement must not stop the web app.
    }
  }
}

export function initStatusBarTheming(): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return () => {};
  }

  let disposed = false;
  let observer: MutationObserver | null = null;
  let mediaQuery: MediaQueryList | null = null;
  let plugins: NativeStatusBarPlugins | null = null;
  let pendingFrame: number | null = null;
  let lastAppliedTopColor: string | null = null;
  let lastAppliedBottomColor: string | null = null;

  const scheduleApply = () => {
    if (disposed || plugins == null || pendingFrame != null) {
      return;
    }
    pendingFrame = window.requestAnimationFrame(() => {
      pendingFrame = null;
      if (disposed || plugins == null) {
        return;
      }
      const topColor = readTopSurfaceHex();
      const bottomColor = readBottomSurfaceHex();
      if (topColor == null || bottomColor == null) {
        return;
      }
      const topChanged = topColor !== lastAppliedTopColor;
      const bottomChanged = bottomColor !== lastAppliedBottomColor;
      if (!topChanged && !bottomChanged) {
        return;
      }
      lastAppliedTopColor = topColor;
      lastAppliedBottomColor = bottomColor;
      void applyStatusBarSurface(plugins, topColor, bottomColor, topChanged);
    });
  };

  void resolveStatusBarPlugins().then(resolved => {
    if (disposed || resolved == null) {
      return;
    }
    plugins = resolved;

    observer = new MutationObserver(scheduleApply);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme', 'data-mode'],
    });

    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', scheduleApply);
    window.addEventListener('scroll', scheduleApply, { passive: true });
    document.addEventListener('scroll', scheduleApply, {
      passive: true,
      capture: true,
    });
    window.addEventListener('resize', scheduleApply, { passive: true });
    scheduleApply();
  });

  return () => {
    disposed = true;
    observer?.disconnect();
    observer = null;
    mediaQuery?.removeEventListener('change', scheduleApply);
    mediaQuery = null;
    window.removeEventListener('scroll', scheduleApply);
    document.removeEventListener('scroll', scheduleApply, true);
    window.removeEventListener('resize', scheduleApply);
    if (pendingFrame != null) {
      window.cancelAnimationFrame(pendingFrame);
      pendingFrame = null;
    }
  };
}
