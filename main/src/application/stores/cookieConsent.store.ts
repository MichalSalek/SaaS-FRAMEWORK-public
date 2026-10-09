// Cookie consent store.
//
// Ten store trzyma JAWNY wybór użytkownika dla analityki (PostHog + GTM/GA4/Clarity);
// jawne odrzucenie (analytics:false, "tylko niezbędne") wyłącza dalsze zbieranie.
// Persystencja w localStorage.
//
// Shape:
//   consent === null  →  brak decyzji (pokaż banner)
//   consent !== null  →  user zdecydował (banner ukryty)
//
// `necessary` zawsze `true`. W store: analytics/marketing null == aktywne;
// jawne odrzucenie ustawia je na `false`.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  deleteLocalStorage,
  getLocalStorage,
  setLocalStorage,
} from '../client-device-storage/local-storage-adapter/localStorage.adapter';
import { STORAGE_KEYS } from '../client-device-storage/storage-keys.config';

interface CookieConsent {
  /** Always true — required for site to function (session, auth, theme). */
  necessary: true;
  /** Analytics (PostHog + GTM/GA4/Clarity). Aktywne dopóki nie odrzucone. */
  analytics: boolean;
  /** Marketing / advertising / remarketing pixels (obecnie nieużywane). */
  marketing: boolean;
}

interface CookieConsentState {
  /** `null` → user has not decided yet (banner visible). */
  consent: CookieConsent | null;
  /** Accept all categories (analytics + marketing both true). */
  acceptAll: () => void;
  /** Reject non-essential (analytics + marketing both false). */
  acceptNecessary: () => void;
  /** Save granular choice. `necessary` is always forced true. */
  setConsent: (partial: { analytics: boolean; marketing: boolean }) => void;
  /** Reset to `null` — banner reappears (used by "change preferences" UI). */
  resetConsent: () => void;
}

/**
 * SSR-safe storage: returns `undefined` on the server so Zustand `persist`
 * skips hydration. The component layer must gate render on a mounted flag to
 * avoid hydration mismatch (server renders nothing, client renders banner if
 * `consent === null`).
 *
 * Reads/writes route through the localStorage adapter (the project-wide
 * canonical client-storage layer) rather than touching `window.localStorage`
 * directly — keeping the consent store inside the same SSOT + error-reporting
 * boundary as every other user-state key.
 */
const safeLocalStorage = createJSONStorage(() => {
  if (typeof window === 'undefined') {
    // Stub for SSR — Zustand will skip persist on the server.
    return {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
  }
  return {
    getItem: (key: string) => getLocalStorage(key),
    setItem: (key: string, value: string) => setLocalStorage(key, value),
    removeItem: (key: string) => deleteLocalStorage(key),
  };
});

export const useCookieConsentStore = create<CookieConsentState>()(
  persist(
    set => ({
      consent: null,
      acceptAll: () =>
        set({
          consent: { necessary: true, analytics: true, marketing: true },
        }),
      acceptNecessary: () =>
        set({
          consent: { necessary: true, analytics: false, marketing: false },
        }),
      setConsent: partial =>
        set({
          consent: {
            necessary: true,
            analytics: partial.analytics,
            marketing: partial.marketing,
          },
        }),
      resetConsent: () => set({ consent: null }),
    }),
    {
      name: STORAGE_KEYS.COOKIE_CONSENT,
      storage: safeLocalStorage,
    }
  )
);
