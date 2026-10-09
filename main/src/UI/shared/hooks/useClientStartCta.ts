// UI/shared/hooks/useClientStartCta.ts
// Device-aware „start" CTA dla ZIMNEJ klientki na stronach marketingowych.
//
// Problem (owner 2026-07-18): klientka na iPhone klikająca „Pobierz aplikację"
// lądowała na /get-app z WYŁĄCZONYMI przyciskami store (Android III kw., iOS
// wkrótce) — ślepy zaułek, bo natywnej apki na iOS nie ma. Produkt DZIAŁA jednak
// w mobile web, więc taka klientka powinna dostać ścieżkę „Zacznij w przeglądarce".
//
// Web-first D0 (owner 2026-08-02): Android dołącza do ścieżki przeglądarkowej,
// DOPÓKI apka nie jest realnie do pobrania — o powrocie Androida do funnelu
// instalacji decyduje kontrakt STORE_URLS (NEXT_PUBLIC_STORE_URL_GOOGLE_PLAY
// ustawiony = /get-app znów ma żywy przycisk, hook wraca sam, zero zmian kodu).
//
// Reguła:
//   - Desktop PREVIEW/PROD (mode='get-app')            → /get-app (funnel do apki, bez zmian)
//   - Android mobile web + store URL LIVE              → /get-app (zainstaluj)
//   - mobile web bez apki do pobrania (iOS zawsze;
//     Android przed premierą w Google Play)            → web-register (produkt w przeglądarce)
//
// Hydration-safe by construction: SSR i pierwszy render klienta zwracają domyślnie
// /get-app (isBrowserStart=false — zgodne z markupem serwera); realną platformę
// mierzymy w efekcie, więc klientka iOS widzi post-mount swap (ten sam wzorzec co
// useAppEntryMode / HeaderUserMenu). Zero mismatchu SSR↔hydracja.

import { useEffect, useState } from 'react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  getStoreUrl,
  hasAnyStoreUrl,
} from '@kernel/domain/platform/platform.config';
import { detectPlatform } from '../../../application/platform/platform.detection';
import { useAppEntryMode } from './useAppEntryMode';

export interface ClientStartCta {
  /** Dokąd prowadzi „start" CTA na tym urządzeniu. */
  href: string;
  /** true → ścieżka przeglądarkowa (iOS/mobile-web bez natywnej apki); label = „Zacznij w przeglądarce". */
  isBrowserStart: boolean;
}

export function useClientStartCta(): ClientStartCta {
  const mode = useAppEntryMode();
  // Domyślnie false → /get-app (zgodne z SSR); efekt przełącza dla iOS/mobile-web.
  const [noNativeApp, setNoNativeApp] = useState(false);

  useEffect(() => {
    const info = detectPlatform();
    // „Brak natywnej apki do zainstalowania" = mobile web bez sklepowego celu:
    // iOS zawsze (natywnej apki nie ma), Android dopóki Play URL nie jest live
    // (web-first D0 — /get-app z wyłączonym przyciskiem = ślepy zaułek).
    const androidStoreLive = hasAnyStoreUrl() && getStoreUrl('android') !== '';
    setNoNativeApp(
      !info.isNativeApp &&
        info.isMobileDevice &&
        (!androidStoreLive || !/Android/i.test(navigator.userAgent))
    );
  }, []);

  // Web-start tylko gdy visitor MOŻE używać apki na tym urządzeniu (mode='app' =
  // mobile/dev, nie desktopowy funnel get-app) ORAZ nie ma apki do pobrania
  // (iOS zawsze; Android przed premierą w Google Play — patrz reguła wyżej).
  const isBrowserStart = mode === 'app' && noNativeApp;

  return {
    href: isBrowserStart
      ? `${ROUTES_FRONT.USER_LOG}?intent=register`
      : ROUTES_FRONT.GET_APP,
    isBrowserStart,
  };
}
