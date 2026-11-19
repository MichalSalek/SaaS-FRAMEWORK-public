import {
  getSalonProfilePath,
  getSalonProfileRedirect,
} from '@kernel/domain/salon-profile/salon.urls';
import type {
  GetServerSidePropsContext,
  InferGetServerSidePropsType,
} from 'next';
import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import type { SalonProfileData } from '@kernel/models/salon-profile/salon-profile.dto';
import { getPublicPageMessages } from '../../application/i18n/i18n.loader';
import { PUBLIC_PAGE_MESSAGES } from '../../application/i18n/page-messages.config';
import { getBackendUrl } from '../../UI/features/stylist/_seo.helpers';
import { SalonProfilePageComposition } from '../../UI/features/salon-profile/SalonProfilePage.composition';
import { PublicSeoHeadComposition } from '../../UI/components/PublicSeoHead/PublicSeoHead.composition';
import { JsonLdComposition } from '../../UI/components/JsonLd';
import { encodePii } from '../../UI/components/Pii/pii.crypto';
import { SEO_CONFIG } from '@kernel/policies/seo.policy';
import {
  buildProfileLinkDestination,
  resolveRetiredProfileLink,
} from '../../application/routing/profile-link-redirect';
// The page renders the salon gallery with the shared photo card, so it loads
// the card's namespace too (a missing one threw MISSING_MESSAGE). The
// error path renders the same body after a client fetch: same list.
export default function SalonPage({
  profile,
  identifier,
  encodedPhone,
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  const path = profile
    ? getSalonProfilePath(profile)
    : getSalonProfilePath({ account_id: identifier });
  return (
    <>
      <PublicSeoHeadComposition
        title={profile?.name || 'Nailfolio'}
        description={profile?.name || 'Nailfolio'}
        path={path}
      />
      {profile && (
        <JsonLdComposition
          data={{
            '@context': 'https://schema.org',
            '@type': 'NailSalon',
            name: profile.name,
            url: `${SEO_CONFIG.domain}${path}`,
            image: profile.works.map(work => work.asset_url),
            employee: [profile.owner, ...profile.members].map(person => ({
              '@type': 'Person',
              name: person.name,
              url: `${SEO_CONFIG.domain}/stylist/${person.identifier}`,
            })),
          }}
        />
      )}
      <SalonProfilePageComposition
        encodedPhone={encodedPhone}
        initialProfile={profile}
        identifier={identifier}
      />
    </>
  );
}
export async function getServerSideProps({
  locale,
  params,
  query,
}: GetServerSidePropsContext) {
  const slug = typeof params?.slug === 'string' ? params.slug : null;
  const id = slug || (typeof params?.id === 'string' ? params.id : '');
  if (!id) {
    return { notFound: true as const };
  }
  const response = await fetch(
    `${getBackendUrl()}${ROUTES_API.SALON_PROFILE_PUBLIC_GET}?identifier=${encodeURIComponent(id)}${slug ? '&by=slug' : ''}`
  ).catch(() => null);
  if (response?.status === 404) {
    // An old salon link of a live salon leads to its current address, permanently
    // (owner, SCHEMA_DECISIONS.md#profile-link-alias).
    const resolved = slug
      ? await resolveRetiredProfileLink({
          backendUrl: getBackendUrl(),
          kind: 'SALON',
          slug,
        })
      : null;
    if (resolved) {
      return {
        redirect: {
          destination: buildProfileLinkDestination({
            kind: 'SALON',
            resolved,
            locale: locale || 'pl',
            query,
            routeParam: 'slug',
          }),
          statusCode: 301 as const,
        },
      };
    }
    return { notFound: true as const };
  }
  if (!response?.ok) {
    const { messages } = await getPublicPageMessages(
      locale || 'pl',
      PUBLIC_PAGE_MESSAGES['/salon/[id]']
    );
    return {
      props: { profile: null, encodedPhone: null, identifier: id, messages },
    };
  }
  const envelope = (await response.json()) as { data: SalonProfileData };
  const redirect = getSalonProfileRedirect(
    envelope.data,
    Boolean(slug),
    locale || 'pl'
  );
  if (redirect) {
    return { redirect };
  }
  const { messages } = await getPublicPageMessages(
    locale || 'pl',
    PUBLIC_PAGE_MESSAGES['/salon/[id]']
  );
  const encodedPhone = envelope.data.contact.phone
    ? encodePii(envelope.data.contact.phone)
    : null;
  const profile = {
    ...envelope.data,
    contact: { ...envelope.data.contact, phone: null },
  };
  return { props: { profile, encodedPhone, identifier: id, messages } };
}
