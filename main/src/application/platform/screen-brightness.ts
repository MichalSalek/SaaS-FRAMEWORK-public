/**
 * DECISION: QR and single-photo views share a maximum-brightness lease. Wake Lock prevents
 * auto-dim in supported browsers; ScreenBrightness boosts the native window. Both are optional.
 * Ownership belongs to the visible view, never to the hook that only prepares its data (owner).
 */
interface ScreenBrightnessPlugin {
  setBrightness(options: { brightness: number }): Promise<void>;
  getBrightness(): Promise<{ brightness: number }>;
}

export interface ScreenBrightnessLease {
  release: () => Promise<void>;
}

let owners = 0;
let pageActive = true;
let pending = Promise.resolve();
let sentinel: WakeLockSentinel | null = null;
let boost: { plugin: ScreenBrightnessPlugin; previous: number } | null = null;
let nativePlugin:
  Promise<{ plugin: ScreenBrightnessPlugin } | null> | undefined;

async function loadNativePlugin() {
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core');
    if (
      !Capacitor.isNativePlatform() ||
      !Capacitor.isPluginAvailable('ScreenBrightness')
    ) {
      return null;
    }
    const plugin = registerPlugin<ScreenBrightnessPlugin>('ScreenBrightness');
    // DECISION: Android's window survives document navigation (including OAuth). Old JS owners
    // cannot survive it. Reset their orphaned override once per document, before any new lease.
    // -1 is BRIGHTNESS_OVERRIDE_NONE: follow system brightness, not a fixed or clamped value.
    if (Capacitor.getPlatform() === 'android') {
      await plugin.setBrightness({ brightness: -1 });
    }
    // A Capacitor proxy must not be returned directly: its `then` is also a native method.
    return { plugin };
  } catch {
    return null;
  }
}

async function acquireWakeLock(): Promise<WakeLockSentinel | null> {
  try {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      return null;
    }
    return await navigator.wakeLock.request('screen');
  } catch {
    return null;
  }
}

async function reconcileBrightness(): Promise<void> {
  nativePlugin ??= loadNativePlugin();
  const native = await nativePlugin;
  const wanted =
    owners > 0 &&
    pageActive &&
    (typeof document === 'undefined' || document.visibilityState !== 'hidden');

  if (wanted) {
    await Promise.all([
      (async () => {
        if (!sentinel || sentinel.released) {
          sentinel = await acquireWakeLock();
        }
      })(),
      (async () => {
        if (!native || boost) {
          return;
        }
        try {
          const { brightness } = await native.plugin.getBrightness();
          await native.plugin.setBrightness({ brightness: 1 });
          boost = { plugin: native.plugin, previous: brightness };
        } catch {
          // Enhancement unavailable: the view remains usable.
        }
      })(),
    ]);
    return;
  }

  await Promise.all([
    (async () => {
      const previousSentinel = sentinel;
      sentinel = null;
      try {
        await previousSentinel?.release();
      } catch {
        // The system may already have released it when the document became hidden.
      }
    })(),
    (async () => {
      if (!boost) {
        return;
      }
      try {
        await boost.plugin.setBrightness({ brightness: boost.previous });
        boost = null;
      } catch {
        // Retain the baseline so the next lifecycle event can retry restoration.
      }
    })(),
  ]);
}

function synchronizeBrightness(): Promise<void> {
  // DECISION: one queue and one baseline for all owners. Per-view snapshots can capture another
  // view's 100% as their baseline; unordered async cleanup can then leave the whole app at 100%.
  pending = pending.then(reconcileBrightness);
  return pending;
}

/** Initialize even on ordinary screens, so a new document repairs an older orphaned override. */
export function initScreenBrightness(): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  pageActive = true;
  const refresh = () => void synchronizeBrightness();
  const hide = () => {
    pageActive = false;
    refresh();
  };
  const show = () => {
    pageActive = true;
    refresh();
  };
  window.addEventListener('pagehide', hide);
  window.addEventListener('pageshow', show);
  document.addEventListener('visibilitychange', refresh);
  refresh();

  return () => {
    window.removeEventListener('pagehide', hide);
    window.removeEventListener('pageshow', show);
    document.removeEventListener('visibilitychange', refresh);
    hide();
  };
}

export async function requestMaxBrightness(): Promise<ScreenBrightnessLease> {
  owners += 1;
  await synchronizeBrightness();
  let released = false;
  return {
    release: () => {
      if (!released) {
        released = true;
        owners -= 1;
      }
      return synchronizeBrightness();
    },
  };
}
