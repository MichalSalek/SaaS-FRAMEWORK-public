import { hapticImpact } from './haptics';
import { detectPlatform } from './platform.detection';

let initialized = false;

export function initHapticPressListener(): void {
  if (initialized) {
    return;
  }
  if (typeof window === 'undefined') {
    return;
  }
  initialized = true;

  // DECISION (nie usuwaj tego komentarza):
  // Resolve platform ONCE at listener init (after window exists). Without this,
  // every .haptic-press click on web fires 2-3 dynamic imports (@capacitor/core
  // + @capacitor/haptics) just to discover `isNativePlatform() === false`.
  // On web we register no listener at all — zero overhead per click.
  const { isNativeApp } = detectPlatform();
  if (!isNativeApp) {
    return;
  }

  document.addEventListener(
    'pointerdown',
    e => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (target.closest('.haptic-press')) {
        void hapticImpact('Light');
      }
    },
    { passive: true }
  );
}
