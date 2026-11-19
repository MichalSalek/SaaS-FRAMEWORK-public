import type {
  GetServerSidePropsContext,
  InferGetServerSidePropsType,
} from 'next';
import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import { getPublicPageMessages } from '../../application/i18n/i18n.loader';
import { PUBLIC_PAGE_MESSAGES } from '../../application/i18n/page-messages.config';
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
import {
  buildProfileLinkDestination,
  resolveRetiredProfileLink,
} from '../../application/routing/profile-link-redirect';

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
  query,
}: GetServerSidePropsContext) {
  const { messages } = await getPublicPageMessages(
    locale || 'pl',
    PUBLIC_PAGE_MESSAGES['/stylist/[identifier]']
  );
  const identifier = params?.identifier as string | undefined;

  if (!identifier) {
    return { notFound: true as const };
  }

  let profile: StylistProfileData | null = null;
  let jsonLdItems: Array<Record<string, unknown>> = [];
  let profileMissing = false;

  try {
    // DECISION: GET_PUBLIC_PROFILE is a QUERY (defineHandler method:'get', reads
    // qStr(req.query,'identifier')). The SSR fetch MUST be a GET with `identifier` in the query
    // string: POST+JSON body got 405 (HTTPRequestHandlerMiddleware enforces the method), so EVERY
    // profile rendered server-side as not-found (generic title, noindex,nofollow, no JSON-LD),
    // deindexing the whole PSEO profile surface despite sitemap-profiles.
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

  // DECISION: only the backend's explicit 404 (ACCOUNT_NOT_FOUND) becomes a real 404; a 200 +
  // noindex for a dead link was a soft 404 to crawlers. Any other failure (backend down, 5xx) still
  // renders the page, whose client query retries and shows its own state.
  if (profileMissing) {
    // An old personal link of a live profile leads to her current one, permanently
    // (owner, SCHEMA_DECISIONS.md#profile-link-alias).
    const resolved = await resolveRetiredProfileLink({
      backendUrl: getBackendUrl(),
      kind: 'STYLIST',
      slug: identifier,
    });
    if (resolved) {
      return {
        redirect: {
          destination: buildProfileLinkDestination({
            kind: 'STYLIST',
            resolved,
            locale: locale || 'pl',
            query,
            routeParam: 'identifier',
          }),
          statusCode: 301 as const,
        },
      };
    }
    return { notFound: true as const };
  }

  const seoMeta = buildSeoMeta(profile, identifier, locale);

  // DECISION: the stylist's PHONE (optional public business contact) is rendered on the VISIBLE
  // profile through PII reveal-on-interaction (<StylistPhoneContact> → decodePii after a trusted
  // interaction). It is encoded SERVER-SIDE (encodePii) and passed as `encodedPhone`, and the
  // plaintext is STRIPPED from `initialProfile` (TQ initialData) so the raw number is not duplicated
  // in the TQ cache and render. initialData has staleTime 60s, so a cold load does not refetch and
  // the plaintext does not come back client-side.
  //
  // Deliberate, NOT a bug: the JSON-LD carries `telephone` on purpose (local-SEO structured
  // data, click-to-call); do not remove it and do not encrypt the JSON-LD.
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
