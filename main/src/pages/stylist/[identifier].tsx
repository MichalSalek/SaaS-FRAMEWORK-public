import type {
  GetServerSidePropsContext,
  InferGetServerSidePropsType,
} from 'next';
import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import { getI18nMessages } from '../../application/i18n/i18n.loader';
import { PublicSeoHeadComposition } from '../../UI/components/PublicSeoHead/PublicSeoHead.composition';
import { StylistProfilePageComposition as StylistProfileFeature } from '../../UI/features/stylist/StylistProfilePage.composition';
import { JsonLdComposition } from '../../UI/components/JsonLd';
import {
  buildStylistProfileJsonLdItems,
  type StylistProfileData,
} from '../../UI/features/stylist/_jsonld.helpers';
import {
  buildSeoMeta,
  getBackendUrl,
} from '../../UI/features/stylist/_seo.helpers';
import { encodePii } from '../../UI/components/Pii/pii.crypto';

type ProfileMetaShape = {
  firstName: string;
  lastName?: string;
  username: string;
};

export default function StylistProfilePage({
  identifier,
  jsonLdItems,
  seoMeta,
  initialProfile,
  encodedPhone,
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  let profileMeta: ProfileMetaShape | undefined;
  if (seoMeta.firstName !== null) {
    profileMeta = {
      firstName: seoMeta.firstName,
      username: seoMeta.username,
      ...(seoMeta.lastName !== null ? { lastName: seoMeta.lastName } : {}),
    };
  }

  const seoHeadProps: Parameters<typeof PublicSeoHeadComposition>[0] = {
    title: seoMeta.title,
    description: seoMeta.description,
    path: seoMeta.path,
    noindex: seoMeta.noindex,
    ogType: 'profile',
    imageAlt: seoMeta.imageAlt,
    ...(seoMeta.ogImage !== null ? { ogImage: seoMeta.ogImage } : {}),
    ...(profileMeta !== undefined ? { profileMeta } : {}),
  };

  return (
    <>
      <PublicSeoHeadComposition {...seoHeadProps} />
      {jsonLdItems.length > 0 && <JsonLdComposition data={jsonLdItems} />}
      <StylistProfileFeature
        identifier={identifier}
        initialProfile={initialProfile}
        encodedPhone={encodedPhone}
      />
    </>
  );
}

export async function getServerSideProps({
  locale,
  params,
}: GetServerSidePropsContext) {
  const messages = await getI18nMessages(locale || 'pl', [
    'stylist',
    'pages.gallery',
    'galleryCard',
    'galleryFilter',
    'galleryStrength',
    'galleryQuickFilters',
    'galleryUI',
  ]);
  const identifier = params?.identifier as string | undefined;

  if (!identifier) {
    return { notFound: true as const };
  }

  let profile: StylistProfileData | null = null;
  let jsonLdItems: Array<Record<string, unknown>> = [];
  let profileMissing = false;

  try {
    // DECISION (nie usuwaj tego komentarza):
    // GET_PUBLIC_PROFILE to QUERY (defineHandler method:'get', czyta qStr(req.query,'identifier')).
    // SSR fetch MUSI być GET z identifier w query-stringu — POST+JSON-body dawał 405
    // (HTTPRequestHandlerMiddleware twardo egzekwuje metodę), przez co KAŻDY profil
    // renderował się server-side jako not-found: generic title, noindex,nofollow, zero
    // JSON-LD — deindeksując całą powierzchnię profili PSEO mimo obecności w sitemap-profiles.
    const apiUrl = `${getBackendUrl()}${ROUTES_API.ACCOUNT_GET_PUBLIC_PROFILE}?identifier=${encodeURIComponent(identifier)}`;

    const response = await fetch(apiUrl, { method: 'GET' });

    profileMissing = response.status === 404;
    if (response.ok) {
      const json = (await response.json()) as { data: StylistProfileData };
      profile = json.data ?? null;

      if (profile != null) {
        jsonLdItems = buildStylistProfileJsonLdItems(
          profile,
          identifier,
          locale
        );
      }
    }
  } catch {
    // Graceful fallback — if backend is unavailable, render page without JSON-LD
  }

  // DECISION (nie usuwaj tego komentarza): only the backend's explicit 404
  // (ACCOUNT_NOT_FOUND) becomes a real 404; a 200 + noindex for a dead link
  // was a soft 404 to crawlers. Any other failure (backend down, 5xx) still
  // renders the page, whose client query retries and shows its own state.
  if (profileMissing) {
    return { notFound: true as const };
  }

  const seoMeta = buildSeoMeta(profile, identifier, locale);

  // DECISION (nie usuwaj tego komentarza):
  // TELEFON stylistki (opcjonalny, publiczny kontakt biznesowy) renderujemy na
  // WIDOCZNYM profilu przez mechanizm PII reveal-on-interaction
  // (<StylistPhoneContact> → decodePii po zaufanej interakcji). Kodujemy go
  // SERVER-SIDE (encodePii) i podajemy jako `encodedPhone`, a z `initialProfile`
  // (TQ initialData) plaintext telefonu STRIPUJEMY — żeby NIE dublować surowego
  // numeru w TQ-cache i renderze (widoczny numer = tylko blob do interakcji).
  // initialData ma staleTime 60s, więc cold-load NIE refetchuje → plaintext nie
  // wraca do cache client-side.
  //
  // UWAGA (świadomie, NIE bug): JSON-LD niesie `telephone` celowo (structured
  // data dla local-SEO, klik-to-call); nie usuwaj go i nie szyfruj JSON-LD.
  const encodedPhone =
    profile?.account.phone != null && profile.account.phone.length > 0
      ? encodePii(profile.account.phone)
      : null;
  const initialProfile =
    profile != null
      ? { ...profile, account: { ...profile.account, phone: null } }
      : profile;

  return {
    props: {
      messages,
      identifier,
      jsonLdItems,
      seoMeta,
      initialProfile,
      encodedPhone,
    },
  };
}
