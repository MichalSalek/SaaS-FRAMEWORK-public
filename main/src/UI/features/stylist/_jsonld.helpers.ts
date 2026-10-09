import { resolveDefaultOgAsset } from '../../assets/brandAssets';
import { SEO_CONFIG } from '@kernel/policies/seo.policy';
import { ORGANIZATION_JSONLD, WEBSITE_JSONLD } from '../../components/JsonLd';
import { buildSeoMeta, seoFallbackName } from './_seo.helpers';
import { normalizeExternalHttpsUrl } from './_website.helpers';

export type StylistProfileData = {
  account: {
    account_id: string;
    display_name: string | null;
    business_name: string | null;
    address_city: string | null;
    address_country: string | null;
    phone: string | null;
    website: string | null;
    description: string | null;
    vanity_url: string | null;
    view_count: number;
    instagram_handle: string | null;
    avatar_url: string | null;
    brand_accent_color: string | null;
  };
  gallery_records_count: number;
  bookmark_count: number;
  total_likes: number;
};

// DECISION (nie usuwaj tego komentarza): values go in RAW. `</script>` safety lives at
// the sink (serializeJsonLd in JsonLdComposition). The old per-field HTML-entity
// escape put literal `&amp;` into data Google reads and broke `&` in website URLs
// inside sameAs, so it is gone rather than extended.

function instagramUrlFromHandle(handle: string): string {
  return `https://instagram.com/${handle.replace(/^@/, '')}`;
}

/**
 * Build JSON-LD NailSalon structured data from profile.
 * Only called when profile data is available (active/public profile).
 *
 * DECISION (nie usuwaj tego komentarza):
 * `geo: GeoCoordinates` is DEFERRED — current backend response (account-profile
 * .operations.ts) does NOT include latitude/longitude in the public profile
 * payload despite columns existing on StylistAccount. Until backend exposes
 * geo coordinates in GET_PUBLIC_PROFILE response DTO, we cannot emit them.
 * Additional `image` array entries beyond avatar (pinned gallery photos) are
 * also DEFERRED — current response does not include `pinned_photos[]`.
 */
export function buildNailSalonJsonLd(
  profile: StylistProfileData,
  canonicalUrl: string,
  locale: string | undefined = 'pl'
): Record<string, unknown> {
  const name = profile.account.display_name || profile.account.business_name;
  if (!name) {
    return {};
  }

  const profileIdentifier =
    profile.account.vanity_url || profile.account.account_id;

  const images: string[] = [];
  if (profile.account.avatar_url) {
    images.push(profile.account.avatar_url);
  }
  if (images.length === 0) {
    images.push(`${SEO_CONFIG.domain}${resolveDefaultOgAsset(locale)}`);
  }

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'NailSalon',
    '@id': `${SEO_CONFIG.domain}/stylist/${profileIdentifier}/#nailsalon`,
    name: name,
    url: canonicalUrl,
    image: images,
    inLanguage: ['pl-PL'],
    isPartOf: { '@id': `${SEO_CONFIG.domain}/#website` },
    publisher: { '@id': `${SEO_CONFIG.domain}/#organization` },
  };

  if (profile.account.address_city) {
    const address: Record<string, string> = {
      '@type': 'PostalAddress',
      addressLocality: profile.account.address_city,
    };
    if (profile.account.address_country) {
      address.addressCountry = profile.account.address_country;
    }
    jsonLd.address = address;
  }

  if (profile.account.description) {
    jsonLd.description = profile.account.description;
  }

  if (profile.account.phone) {
    jsonLd.telephone = profile.account.phone;
  }

  // DECISION (nie usuwaj tego komentarza) — 2026-09-09:
  // `url` węzła to nasz profil na Nailfolio (canonicalUrl), więc własna strona
  // stylistki idzie do `sameAs` — schema.org trzyma tam inne adresy TEJ SAMEJ
  // encji (obok Instagrama). Wpis powstaje tylko dla realnego https:// (write-path
  // waliduje przez validateOptionalHttpsUrl, render nie ufa w ciemno), pusta
  // wartość nie trafia do tablicy, a cała tablica znika, gdy nie ma czego pokazać.
  const sameAs: string[] = [];
  if (profile.account.instagram_handle) {
    sameAs.push(instagramUrlFromHandle(profile.account.instagram_handle));
  }
  const websiteUrl = normalizeExternalHttpsUrl(profile.account.website);
  if (websiteUrl) {
    sameAs.push(websiteUrl);
  }
  if (sameAs.length > 0) {
    jsonLd.sameAs = sameAs;
  }

  const hasInteractions =
    profile.total_likes > 0 ||
    profile.bookmark_count > 0 ||
    profile.account.view_count > 0;
  if (hasInteractions) {
    const interactionStatistic: Array<Record<string, unknown>> = [];
    if (profile.total_likes > 0) {
      interactionStatistic.push({
        '@type': 'InteractionCounter',
        interactionType: { '@type': 'LikeAction' },
        userInteractionCount: profile.total_likes,
      });
    }
    if (profile.bookmark_count > 0) {
      interactionStatistic.push({
        '@type': 'InteractionCounter',
        interactionType: { '@type': 'BookmarkAction' },
        userInteractionCount: profile.bookmark_count,
      });
    }
    if (profile.account.view_count > 0) {
      interactionStatistic.push({
        '@type': 'InteractionCounter',
        interactionType: { '@type': 'ViewAction' },
        userInteractionCount: profile.account.view_count,
      });
    }
    jsonLd.interactionStatistic = interactionStatistic;
  }

  return jsonLd;
}

/**
 * Build JSON-LD Person structured data for the stylist (person behind the salon).
 * Returns null when no name is available.
 */
export function buildPersonJsonLd(
  profile: StylistProfileData,
  canonicalUrl: string
): Record<string, unknown> | null {
  const name = profile.account.display_name || profile.account.business_name;
  if (!name) {
    return null;
  }

  const profileIdentifier =
    profile.account.vanity_url || profile.account.account_id;

  const personJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': `${SEO_CONFIG.domain}/stylist/${profileIdentifier}/#person`,
    name: name,
    jobTitle: 'Stylistka paznokci',
    url: canonicalUrl,
    knowsLanguage: ['pl'],
  };

  if (profile.account.avatar_url) {
    personJsonLd.image = profile.account.avatar_url;
  }

  if (profile.account.description) {
    personJsonLd.description = profile.account.description.slice(0, 500);
  }

  if (profile.account.phone) {
    personJsonLd.telephone = profile.account.phone;
  }

  if (profile.account.instagram_handle) {
    personJsonLd.sameAs = [
      instagramUrlFromHandle(profile.account.instagram_handle),
    ];
  }

  const salonName =
    profile.account.business_name || profile.account.display_name;
  if (salonName) {
    personJsonLd.worksFor = {
      '@type': 'NailSalon',
      name: salonName,
    };
  }

  if (profile.account.address_city) {
    personJsonLd.address = {
      '@type': 'PostalAddress',
      addressLocality: profile.account.address_city,
    };
  }

  return personJsonLd;
}

/**
 * Build BreadcrumbList JSON-LD for the stylist profile.
 *
 * DECISION (nie usuwaj tego komentarza):
 * 2-element breadcrumb (Home → profile). A public /stylists list page does NOT
 * exist yet (only /for-stylists marketing LP and /app/stylists for logged-in
 * users) — adding a middle hop would point to a non-existent or auth-gated
 * route and break Google's breadcrumb validation. Extend to 3 elements once a
 * public stylists discovery page ships.
 */
export function buildBreadcrumbJsonLd(
  canonicalUrl: string,
  displayName: string
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Nailfolio',
        item: SEO_CONFIG.domain,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: displayName,
        item: canonicalUrl,
      },
    ],
  };
}

export function buildProfilePageJsonLd(params: {
  canonicalUrl: string;
  profileIdentifier: string;
  title: string;
  description: string;
  ogImage: string;
  breadcrumb: Record<string, unknown>;
  nailSalon: Record<string, unknown>;
  person: Record<string, unknown> | null;
}): Record<string, unknown> {
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    '@id': `${SEO_CONFIG.domain}/stylist/${params.profileIdentifier}/#profilepage`,
    // canonicalUrl juz konczy sie na "/" (C-seo-35) — bez dodatkowego slasha.
    url: params.canonicalUrl,
    name: params.title,
    description: params.description,
    inLanguage: 'pl-PL',
    isPartOf: { '@id': `${SEO_CONFIG.domain}/#website` },
    primaryImageOfPage: {
      '@type': 'ImageObject',
      url: params.ogImage,
    },
    breadcrumb: params.breadcrumb,
    mainEntity: params.nailSalon,
  };
  if (params.person) {
    jsonLd.about = params.person;
  }
  return jsonLd;
}

/**
 * Assemble the full SSR JSON-LD graph for a public stylist profile.
 *
 * Extracted verbatim from `pages/stylist/[identifier].tsx` getServerSideProps
 * (FDX W4.4 outlier extraction) — same node order, same guards, same canonical
 * URL construction (C-seo-35). Returns an empty array when the profile lacks a
 * name (caller still renders the page without structured data).
 */
export function buildStylistProfileJsonLdItems(
  profile: StylistProfileData,
  identifier: string,
  locale: string | undefined = 'pl'
): Array<Record<string, unknown>> {
  const jsonLdItems: Array<Record<string, unknown>> = [];

  if (!(profile.account.display_name || profile.account.business_name)) {
    return jsonLdItems;
  }

  const profileIdentifier =
    profile.account.vanity_url || profile.account.account_id;
  // Trailing slash to match the served URL (next.config trailingSlash:true) and
  // the canonical <link> (PublicSeoHead normalizuje do /stylist/id/). JSON-LD
  // url/@id-base (NailSalon/Person/breadcrumb) musza byc spojne z canonical (C-seo-35).
  const canonicalUrl = `${SEO_CONFIG.domain}/stylist/${profileIdentifier}/`;
  const displayName =
    profile.account.display_name ||
    profile.account.business_name ||
    seoFallbackName(locale);

  const nailSalonJsonLd = buildNailSalonJsonLd(profile, canonicalUrl, locale);
  const personJsonLd = buildPersonJsonLd(profile, canonicalUrl);
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(canonicalUrl, displayName);

  const tempSeo = buildSeoMeta(profile, identifier, locale);
  const ogImage =
    profile.account.avatar_url ??
    `${SEO_CONFIG.domain}${resolveDefaultOgAsset(locale)}`;

  const profilePageJsonLd =
    Object.keys(nailSalonJsonLd).length > 0
      ? buildProfilePageJsonLd({
          canonicalUrl,
          profileIdentifier,
          title: tempSeo.title,
          description: tempSeo.description,
          ogImage,
          breadcrumb: breadcrumbJsonLd,
          nailSalon: nailSalonJsonLd,
          person: personJsonLd,
        })
      : null;

  jsonLdItems.push({ ...WEBSITE_JSONLD });
  jsonLdItems.push({ ...ORGANIZATION_JSONLD });
  if (Object.keys(nailSalonJsonLd).length > 0) {
    jsonLdItems.push(nailSalonJsonLd);
  }
  if (personJsonLd) {
    jsonLdItems.push(personJsonLd);
  }
  if (profilePageJsonLd) {
    jsonLdItems.push(profilePageJsonLd);
  }
  jsonLdItems.push(breadcrumbJsonLd);

  return jsonLdItems;
}
