import { BRAND_CONFIG } from './brand.config';

export type NativeAppPlatform = 'android' | 'ios';
export type AppPlatform = NativeAppPlatform | 'web';

/** Mobile OS of a web (non-native) visitor — used to route /get-app store
 *  buttons to the correct store. 'other' = desktop/unknown (show both). */
export type MobileOs = 'ios' | 'android' | 'other';

export type PlatformInfo = {
  isNativeApp: boolean;
  platform: AppPlatform;
  isMobileDevice: boolean;
};

export const PLATFORM_QUERY_PARAM = 'platform' as const;
export const PLATFORM_STORAGE_KEY = 'native_app_platform' as const;

export const PLATFORM_GATE_BYPASS_PARAM = 'bypass' as const;
export const PLATFORM_GATE_BYPASS_STORAGE_KEY = 'gate_bypass' as const;

export const PLATFORM_CONFIG = Object.freeze({
  GATE_ENABLED: false,
  BYPASS_SECRET: process.env.NEXT_PUBLIC_PLATFORM_GATE_BYPASS || '',
  // Public store URLs. Empty = app not published yet (-> /get-app shows the
  // "coming soon" state). Paste the real URLs into NEXT_PUBLIC_STORE_URL_*
  // (env) when the app goes live; the buttons activate with no code change.
  STORE_URLS: {
    GOOGLE_PLAY: process.env.NEXT_PUBLIC_STORE_URL_GOOGLE_PLAY ?? '',
    APP_STORE: process.env.NEXT_PUBLIC_STORE_URL_APP_STORE ?? '',
  },
  DEEP_LINK_SCHEME: BRAND_CONFIG.deepLinkScheme,
} as const);

/**
 * Store URL for a detected mobile OS, or '' when that store isn't live yet.
 * iOS -> App Store, Android -> Google Play, anything else -> '' (no single store).
 */
export const getStoreUrl = (os: MobileOs): string => {
  if (os === 'ios') {
    return PLATFORM_CONFIG.STORE_URLS.APP_STORE;
  }
  if (os === 'android') {
    return PLATFORM_CONFIG.STORE_URLS.GOOGLE_PLAY;
  }
  return '';
};

/** True once at least one store URL is configured (app is downloadable). */
export const hasAnyStoreUrl = (): boolean =>
  PLATFORM_CONFIG.STORE_URLS.APP_STORE !== '' ||
  PLATFORM_CONFIG.STORE_URLS.GOOGLE_PLAY !== '';
