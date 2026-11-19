// UI/shared/hooks/useClientStartCta.ts
// Device-aware „start" CTA for a cold client on public marketing pages.
//
// Problem (owner): a client on an iPhone tapping „Pobierz aplikację" landed on /get-app with the
// store buttons DISABLED, a dead end (no native iOS app). The product works in mobile web, so she
// gets a „start in the browser" path. Android joins it until the app is downloadable: the
// STORE_URLS contract (NEXT_PUBLIC_STORE_URL_GOOGLE_PLAY set) returns Android to /get-app.
//
// Routing: desktop in every environment uses browser registration; Android mobile web with a live
// Play URL goes to /get-app; other mobile web uses browser registration.
//
// Hydration-safe: SSR and the first client render return /get-app (isBrowserStart=false),
// matching the server markup; the platform is measured in an effect, so the CTA switches after
// mount (same pattern as useAppEntryMode / HeaderUserMenu).

import { useEffect, useState } from 'react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  getStoreUrl,
  hasAnyStoreUrl,
} from '@kernel/domain/platform/platform.config';
import { detectPlatform } from '../../../application/platform/platform.detection';

export interface ClientStartCta {
  /** Where the „start" CTA leads on this device. */
  href: string;
  /** true means web registration on desktop or a mobile device without an available app. */
  isBrowserStart: boolean;
}

export function useClientStartCta(): ClientStartCta {
  // Default false -> /get-app (matches SSR); the effect switches to web start when the device
  // has no app to download or the client is on desktop.
  const [noNativeApp, setNoNativeApp] = useState(false);

  useEffect(() => {
    const info = detectPlatform();
    // Desktop registers in the browser at once, to avoid a /get-app -> /for-clients -> /get-app
    // loop. Android with a live Play link keeps the install path; other devices use web start.
    const androidStoreLive = hasAnyStoreUrl() && getStoreUrl('android') !== '';
    const canInstallAndroid =
      info.isMobileDevice &&
      /Android/i.test(navigator.userAgent) &&
      androidStoreLive;
    setNoNativeApp(!info.isNativeApp && !canInstallAndroid);
  }, []);

  const isBrowserStart = noNativeApp;

  return {
    href: isBrowserStart
      ? `${ROUTES_FRONT.USER_LOG}?intent=register`
      : ROUTES_FRONT.GET_APP,
    isBrowserStart,
  };
}
