import type { PlatformInfo } from '@kernel/domain/platform/platform.config';
import {
  PLATFORM_QUERY_PARAM,
  PLATFORM_STORAGE_KEY,
} from '@kernel/domain/platform/platform.config';

export const detectPlatform = (): PlatformInfo => {
  if (typeof window === 'undefined') {
    return { isNativeApp: false, platform: 'web', isMobileDevice: false };
  }

  // 1. Check sessionStorage (persists across navigations within session)
  const stored = sessionStorage.getItem(PLATFORM_STORAGE_KEY);
  if (stored === 'android' || stored === 'ios') {
    return { isNativeApp: true, platform: stored, isMobileDevice: true };
  }

  // 2. Check URL param (first load from launcher)
  const urlParam = new URLSearchParams(window.location.search).get(
    PLATFORM_QUERY_PARAM
  );
  if (urlParam === 'android' || urlParam === 'ios') {
    sessionStorage.setItem(PLATFORM_STORAGE_KEY, urlParam);
    return { isNativeApp: true, platform: urlParam, isMobileDevice: true };
  }

  // 3. JS Bridge fallback (for future non-Capacitor native wrappers)
  if (window.__NATIVE_APP__) {
    const p = window.__NATIVE_APP__.platform;
    sessionStorage.setItem(PLATFORM_STORAGE_KEY, p);
    return { isNativeApp: true, platform: p, isMobileDevice: true };
  }

  // 4. Web browser
  const isMobile =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    window.innerWidth < 768;
  return { isNativeApp: false, platform: 'web', isMobileDevice: isMobile };
};
