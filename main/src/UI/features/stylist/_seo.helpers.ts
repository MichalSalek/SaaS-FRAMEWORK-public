import { resolveDefaultOgAsset } from '../../assets/brandAssets';
import { SEO_CONFIG } from '@kernel/policies/seo.policy';
import { ENV_VARS } from '../../../application/environment/environment.config';
import type { StylistProfileData } from './_jsonld.helpers';

/**
 * SEO meta builders + backend-URL helper for the public stylist profile page.
 *
 * Extracted from `pages/stylist/[identifier].tsx` to keep the page a thin shell.
 * Pure helpers (`splitName`, `buildSeoMeta`, `getBackendUrl`) live here and are
 * unit-tested; behaviour is identical to the prior inline code.
 */

export type SeoMeta = {
  title: string;
  description: string;
  path: string;
  noindex: boolean;
  ogImage: string | null;
  imageAlt: string;
  firstName: string | null;
  lastName: string | null;
  username: string;
};

export function splitName(fullName: string): {
  first: string;
  last: string | null;
} {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0] ?? fullName;
  const last = parts.length > 1 ? parts.slice(1).join(' ') : null;
  return { first, last };
}

// Meta copy per locale. The page emits hreflang en/de with a canonical per
// language, so EN/DE crawlers must not receive Polish title/description/alt —
// that is exactly the mismatch search engines demote. Server-side helper (no
// next-intl `t` here), hence a small template map keyed by locale; `pl` is the
// default and the entry the existing tests exercise.
type SeoLocale = 'pl' | 'en' | 'de';
interface SeoCopy {
  fallbackTitle: string;
  fallbackDescription: string;
  fallbackImageAlt: string;
  fallbackName: string;
  title: (name: string, city: string | null | undefined) => string;
  description: (name: string, city: string | null | undefined) => string;
  imageAlt: (name: string) => string;
}
const SEO_COPY: Record<SeoLocale, SeoCopy> = {
  pl: {
    fallbackTitle: 'Profil stylistki',
    fallbackDescription: 'Profil stylistki paznokci na Nailfolio.',
    fallbackImageAlt: 'Profil stylistki paznokci na Nailfolio',
    fallbackName: 'Stylistka paznokci',
    title: (name, city) =>
      city
        ? `${name}, stylistka paznokci (${city})`
        : `${name}, stylistka paznokci`,
    description: (name, city) =>
      city
        ? `Portfolio stylistki paznokci ${name} (${city}) w Nailfolio. Galeria stylizacji, sesje inspiracji, kontakt.`
        : `Portfolio stylistki paznokci ${name} w Nailfolio. Galeria stylizacji, sesje inspiracji, kontakt.`,
    imageAlt: name => `Profil stylistki paznokci ${name} na Nailfolio`,
  },
  en: {
    fallbackTitle: 'Nail stylist profile',
    fallbackDescription: 'Nail stylist profile on Nailfolio.',
    fallbackImageAlt: 'Nail stylist profile on Nailfolio',
    fallbackName: 'Nail stylist',
    title: (name, city) =>
      city ? `${name}, nail stylist (${city})` : `${name}, nail stylist`,
    description: (name, city) =>
      city
        ? `Nail portfolio for ${name} in ${city} on Nailfolio, with a gallery of nail designs, Inspiration Sessions and contact details.`
        : `Nail portfolio for ${name} on Nailfolio, with a gallery of nail designs, Inspiration Sessions and contact details.`,
    imageAlt: name => `Nail stylist ${name} on Nailfolio`,
  },
  de: {
    fallbackTitle: 'Profil der Nageldesignerin',
    fallbackDescription: 'Profil einer Nageldesignerin auf Nailfolio.',
    fallbackImageAlt: 'Profil einer Nageldesignerin auf Nailfolio',
    fallbackName: 'Nageldesignerin',
    title: (name, city) =>
      city ? `${name}, Nageldesignerin (${city})` : `${name}, Nageldesignerin`,
    description: (name, city) =>
      city
        ? `Nageldesign-Portfolio von ${name} (${city}) auf Nailfolio. Galerie, Inspirationssitzungen und Kontakt.`
        : `Nageldesign-Portfolio von ${name} auf Nailfolio. Galerie, Inspirationssitzungen und Kontakt.`,
    imageAlt: name => `Nageldesignerin ${name} auf Nailfolio`,
  },
};

export function resolveSeoLocale(locale: string | undefined): SeoLocale {
  return locale === 'en' || locale === 'de' ? locale : 'pl';
}

/** Locale-aware display-name fallback shared with the JSON-LD builders. */
export function seoFallbackName(locale: string | undefined): string {
  return SEO_COPY[resolveSeoLocale(locale)].fallbackName;
}

export function buildSeoMeta(
  profile: StylistProfileData | null,
  identifier: string,
  locale: string | undefined = 'pl'
): SeoMeta {
  const copy = SEO_COPY[resolveSeoLocale(locale)];
  if (!profile) {
    return {
      title: copy.fallbackTitle,
      description: copy.fallbackDescription,
      path: `/stylist/${identifier}`,
      noindex: true,
      // Not-found profiles fall through to PublicSeoHead's default card; the dynamic OG
      // endpoint would return a generic card anyway, so skip the extra fetch.
      ogImage: null,
      imageAlt: copy.fallbackImageAlt,
      firstName: null,
      lastName: null,
      username: identifier,
    };
  }
  const ownName = profile.account.display_name || profile.account.business_name;
  const name = ownName || copy.fallbackName;
  const city = profile.account.address_city;
  const baseDescription = profile.account.description?.trim();
  const canonicalIdentifier =
    profile.account.vanity_url || profile.account.account_id;

  // DECISION: a profile with neither a display name nor a business name (onboarding asks
  // only the role) is NOT indexed: the name templates would read „Stylistka paznokci,
  // stylistka paznokci” and the page is thin. It indexes on the first render after she
  // names herself.
  if (!ownName) {
    return {
      title: copy.fallbackTitle,
      description: baseDescription
        ? baseDescription.slice(0, 160)
        : copy.fallbackDescription,
      path: `/stylist/${canonicalIdentifier}`,
      noindex: true,
      ogImage: `${SEO_CONFIG.domain}${resolveDefaultOgAsset(locale)}`,
      imageAlt: copy.fallbackImageAlt,
      firstName: null,
      lastName: null,
      username: profile.account.vanity_url ?? profile.account.account_id,
    };
  }
  const description = baseDescription
    ? baseDescription.slice(0, 160)
    : copy.description(name, city);
  const { first, last } = splitName(name);

  // DECISION: og:image is the per-stylist card from /api/og/stylist/[id]/, localized via
  // `?locale=` for EN and DE. The route loads @vercel/og with a native import, because the
  // webpack build rewrote its `new URL(..., import.meta.url)` and the module threw on load
  // (DECISION in pages/api/og/stylist/[identifier].ts); any failure answers 302 to the
  // static card of the page's language. Trailing slash kept: canonical under trailingSlash.
  const ogLocale = resolveSeoLocale(locale);
  const ogImage = `${SEO_CONFIG.domain}/api/og/stylist/${encodeURIComponent(canonicalIdentifier)}/${ogLocale === 'pl' ? '' : `?locale=${ogLocale}`}`;

  return {
    title: copy.title(name, city),
    description,
    path: `/stylist/${canonicalIdentifier}`,
    noindex: false,
    ogImage,
    imageAlt: copy.imageAlt(name),
    firstName: first,
    lastName: last,
    username: profile.account.vanity_url ?? profile.account.account_id,
  };
}

export function getBackendUrl(): string {
  const port = ENV_VARS.NEXT_PUBLIC_BACKEND_PUBLIC_PORT;
  return `${ENV_VARS.NEXT_PUBLIC_HTTP_PROTOCOL}${ENV_VARS.NEXT_PUBLIC_BACKEND_PUBLIC_DOMAIN}${port ? `:${port}` : ''}`;
}
