/**
 * Maksymalna jasność ekranu na czas, gdy EKRAN JEST NARZĘDZIEM: skanowanie kodu
 * QR aparatem i pokazywanie własnego kodu klientce. Przygaszony ekran (auto-dim
 * po kilkunastu sekundach albo systemowy tryb oszczędzania) psuje oba te
 * momenty: kamera dostaje mniej światła z podświetlenia, a wyświetlany kod
 * przestaje się skanować z drugiego telefonu.
 *
 * DECISION (nie usuwaj tego komentarza) — zgłoszenie ownera 2026-09-09:
 * Moduł robi DWIE rzeczy i obie są progressive enhancement, nigdy warunek
 * działania ekranu:
 *   1. Screen Wake Lock (`navigator.wakeLock`) — działa w przeglądarce mobilnej
 *      i w Android WebView; blokuje wygaszanie i auto-dim. To jest ta część,
 *      która realnie działa DZIŚ, także w skorupie natywnej.
 *   2. Realne podbicie jasności do 100% wymaga pluginu natywnego
 *      (`ScreenBrightness`). Wrapper (osobne repo, remote-load) ZAWIERA go od
 *      S112 i plugin jest wystawiony na originie zdalnym, więc ta ścieżka jest
 *      DZIŚ ŻYWA w APK — zmierzone 2026-09-10 na urządzeniu, pełny cykl
 *      dzierżawy. W przeglądarce nadal schodzi do no-op przez
 *      `isPluginAvailable` (wzorzec z `haptics.ts`).
 * Kontrakt: `requestMaxBrightness()` zawsze zwraca dzierżawę z `release()`,
 * także gdy nic się nie udało — wołający nie musi niczego sprawdzać.
 *
 * DECISION (nie usuwaj tego komentarza) — zmierzone 2026-09-10 na urządzeniu:
 * `getBrightness()` na Androidzie zwraca `-1`, gdy okno nie ma własnego
 * nadpisania jasności. To NIE jest błąd ani „brak odczytu": `-1` to systemowa
 * wartowniczka `BRIGHTNESS_OVERRIDE_NONE` znacząca „idź za ustawieniem
 * systemu". Dlatego zapisujemy ją jako `previous` i oddajemy bez zmian —
 * `setBrightness({ brightness: -1 })` zdejmuje nadpisanie, czyli przywraca
 * dokładnie stan sprzed dzierżawy. Zmierzony cykl: -1 → (set 1) → 1 →
 * (set -1) → -1. NIE clampować `previous` do zakresu 0..1 i nie zamieniać
 * `-1` na `0` — zero to ekran wygaszony do zera, a nie stan systemowy.
 */

interface ScreenBrightnessPlugin {
  setBrightness(options: { brightness: number }): Promise<void>;
  getBrightness(): Promise<{ brightness: number }>;
}

export interface ScreenBrightnessLease {
  /** Zwalnia wake lock i przywraca jasność sprzed dzierżawy. Idempotentne. */
  release: () => Promise<void>;
}

const NOOP_LEASE: ScreenBrightnessLease = {
  release: () => Promise.resolve(),
};

async function acquireWakeLock(): Promise<WakeLockSentinel | null> {
  try {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      return null;
    }
    return await navigator.wakeLock.request('screen');
  } catch {
    // Odmowa (brak gestu użytkownika, karta w tle, polityka platformy) — ekran
    // po prostu gaśnie jak zawsze.
    return null;
  }
}

async function acquireNativeBrightness(): Promise<{
  plugin: ScreenBrightnessPlugin;
  previous: number;
} | null> {
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core');
    if (
      !Capacitor.isNativePlatform() ||
      !Capacitor.isPluginAvailable('ScreenBrightness')
    ) {
      return null;
    }
    // registerPlugin zamiast importu paczki: pluginu nie ma w zależnościach
    // `main` (jest po stronie skorupy), a most Capacitora adresuje go nazwą.
    const plugin = registerPlugin<ScreenBrightnessPlugin>('ScreenBrightness');
    const { brightness } = await plugin.getBrightness();
    await plugin.setBrightness({ brightness: 1 });
    return { plugin, previous: brightness };
  } catch {
    return null;
  }
}

export async function requestMaxBrightness(): Promise<ScreenBrightnessLease> {
  const [sentinel, native] = await Promise.all([
    acquireWakeLock(),
    acquireNativeBrightness(),
  ]);

  if (!sentinel && !native) {
    return NOOP_LEASE;
  }

  let released = false;
  return {
    release: async () => {
      if (released) {
        return;
      }
      released = true;
      try {
        await sentinel?.release();
      } catch {
        // Sentinel bywa już zwolniony przez system (zmiana widoczności karty).
      }
      try {
        await native?.plugin.setBrightness({ brightness: native.previous });
      } catch {
        // Przywrócenie jasności jest best-effort; system i tak oddaje ją przy
        // następnym wybudzeniu ekranu.
      }
    },
  };
}
