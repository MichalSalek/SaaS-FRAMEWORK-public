import { resolveDefaultOgAsset } from '../../assets/brandAssets';
import { SEO_CONFIG } from '@kernel/policies/seo.policy';
import { ENV_VARS } from '../../../application/environment/environment.config';
import type { StylistProfileData } from './_jsonld.helpers';

/**
 * SEO meta builders + backend-URL helper for the public stylist profile page.
 *
 * Extracted from `pages/stylist/[identifier].tsx` to keep the page a thin shell
 * (FDX W4.4 outlier extraction). Pure helpers (`splitName`, `buildSeoMeta`,
 * `getBackendUrl`) live here and are unit-tested; behaviour is identical to the
 * prior inline code — only the location changed.
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
        ? `Portfolio stylistki paznokci ${name} (${city}) na Nailfolio. Galeria stylów, sesje inspiracji, kontakt.`
        : `Portfolio stylistki paznokci ${name} na Nailfolio. Galeria stylów, sesje inspiracji, kontakt.`,
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
        ? `Nail portfolio of ${name} (${city}) on Nailfolio. Style gallery, inspiration sessions, contact.`
        : `Nail portfolio of ${name} on Nailfolio. Style gallery, inspiration sessions, contact.`,
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
        ? `Nagel-Portfolio von ${name} (${city}) auf Nailfolio. Stilgalerie, Inspirationssitzungen, Kontakt.`
        : `Nagel-Portfolio von ${name} auf Nailfolio. Stilgalerie, Inspirationssitzungen, Kontakt.`,
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
      // DECISION (nie usuwaj tego komentarza):
      // Not-found profiles use null (falls through to PublicSeoHead default
      // /og-default.png). Dynamic OG endpoint is skipped — it would also return
      // a generic card for unknown identifiers, but we avoid the extra fetch.
      ogImage: null,
      imageAlt: copy.fallbackImageAlt,
      firstName: null,
      lastName: null,
      username: identifier,
    };
  }
  const name =
    profile.account.display_name ||
    profile.account.business_name ||
    copy.fallbackName;
  const city = profile.account.address_city;
  const baseDescription = profile.account.description?.trim();
  const description = baseDescription
    ? baseDescription.slice(0, 160)
    : copy.description(name, city);
  const canonicalIdentifier =
    profile.account.vanity_url || profile.account.account_id;
  const { first, last } = splitName(name);

  // DECISION (nie usuwaj tego komentarza):
  // og:image = STATYCZNY /og-default.png, NIE dynamic /api/og/stylist/[id].
  // Branded OG per-stylist (imię+miasto+avatar, 1200×630) crashuje na PROD:
  // @vercel/og `unstable_createNodejsStream` rzuca PRZY IMPORCIE w produkcyjnym
  // standalone ("path must be of type string, Received an instance of URL" —
  // import.meta.url→URL ładowanie WASM/fontu w bundled Node; błąd PRZED handlerem,
  // więc catch→302 go nie łapie). Zweryfikowane 2026-07-01 (generic i profilowy
  // OG oba 500 na prod; dev OK bo node_modules pełne; outputFileTracingIncludes
  // WASM nie pomógł — problem to SPOSÓB ładowania, nie brak pliku). Static
  // fallback = zawsze 200 = działający social preview (generic branded).
  // PRZYWRÓCENIE branded OG: gdy @vercel/og-standalone-import rozwiązany — kod
  // endpointu /api/og/stylist/* ZOSTAJE nietknięty, wystarczy wskazać tu z powrotem
  // `${SEO_CONFIG.domain}/api/og/stylist/${canonicalIdentifier}/` (trailing slash!
  // trailingSlash:true → bez slasha 308, część crawlerów og:image nie followuje).
  return {
    title: copy.title(name, city),
    description,
    path: `/stylist/${canonicalIdentifier}`,
    noindex: false,
    ogImage: `${SEO_CONFIG.domain}${resolveDefaultOgAsset(locale)}`,
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
