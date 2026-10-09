import {
  getLocaleOrDefault,
  type LocaleType,
} from '@kernel/domain/i18n/i18n.config';
import lpAssetsConfig from './lp-assets.config.json';

// Versioned URLs are shared by LP images and root-level brand derivatives.
export const refreshedAsset = (path: string): string =>
  `${path}?v=${lpAssetsConfig.version}`;

export const BRAND_ASSETS = {
  favicon: refreshedAsset('/favicon.ico'),
  icon192: refreshedAsset('/icon-192.png'),
  icon512: refreshedAsset('/icon-512.png'),
  iconMaskable512: refreshedAsset('/icon-maskable-512.png'),
  appleTouchIcon: refreshedAsset('/apple-touch-icon.png'),
  ogDefault: refreshedAsset('/og-default.png'),
  ogDefaultEn: refreshedAsset('/og-default-en.png'),
  ogDefaultDe: refreshedAsset('/og-default-de.png'),
  logo: refreshedAsset('/logo.png'),
  logoFull: refreshedAsset('/logo-full.png'),
} as const;

/** The visible text in default social cards must match the page language. */
export function resolveDefaultOgAsset(locale: string | undefined): string {
  const images: Record<LocaleType, string> = {
    pl: BRAND_ASSETS.ogDefault,
    en: BRAND_ASSETS.ogDefaultEn,
    de: BRAND_ASSETS.ogDefaultDe,
  };
  return images[getLocaleOrDefault(locale)];
}
