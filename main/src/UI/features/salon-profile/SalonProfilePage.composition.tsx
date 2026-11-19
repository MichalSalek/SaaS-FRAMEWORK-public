import { queryKeys } from '../../../application/http/queryKeys.factory';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { brandScopeProps } from '../shared/branding/brandScope';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../application/routing/buildRoute';
import { useRouter } from 'next/router';
import { SalonGalleryOrganism } from './SalonGallery.organism';
import { useQuery } from '@tanstack/react-query';
import { getPublicSalonProfile_IO } from '../../../domain/salon-profile/salonProfileIO.possibilities.api';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import salonStyles from './SalonProfilePage.module.css';
import { useTranslations } from 'next-intl';
import type {
  SalonProfileData,
  SalonProfilePerson,
} from '@kernel/models/salon-profile/salon-profile.dto';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../components/NavRow/NavRow.molecule';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { readAddressStreet } from '../stylist/_profile-address.helpers';
import { StylistProfileHeaderOrganism } from '../stylist/StylistProfileHeader.organism';
import { StylistProfileContactMolecule } from '../stylist/StylistProfileContact.molecule';
import { GalleryPhotoCardOrganism } from '../../components/GalleryPhotoCard/GalleryPhotoCard.organism';
import { AppLinkAtom } from '../../components/AppLink/AppLink.atom';
import manageStyles from './SalonProfileManage.module.css';
import { encodePii } from '../../components/Pii/pii.crypto';
import styles from '../stylist/StylistProfilePage.module.css';
function Person({
  person,
  role,
}: {
  person: SalonProfilePerson;
  role: string;
}) {
  return (
    <NavRowMolecule
      href={buildRoute(ROUTES_FRONT.STYLIST_PROFILE, {
        identifier: person.identifier,
      })}
      label={person.name}
      description={role}
      leading={
        <AvatarAtom
          name={person.name}
          src={person.avatar_url ?? undefined}
          fallbackSrc={person.avatar_fallback_url ?? undefined}
          decorative
        />
      }
      trailing='disc'
    />
  );
}
export function SalonProfilePageComposition({
  initialProfile,
  identifier,
  encodedPhone = null,
}: {
  initialProfile: SalonProfileData | null;
  encodedPhone?: string | null;
  identifier: string;
}) {
  const t = useTranslations('salon.profile');
  const router = useRouter();
  const slugRoute = router.pathname === '/s/[slug]';
  const query = useQuery({
    queryKey: queryKeys.salon.publicProfile(identifier, slugRoute),
    queryFn: ({ signal }) =>
      getPublicSalonProfile_IO(
        { identifier, ...(slugRoute ? { by: 'slug' as const } : {}) },
        { signal }
      ),
    ...(initialProfile ? { initialData: initialProfile } : {}),
  });
  if (query.isLoading) {
    return (
      <PublicLayoutComposition>
        <SkeletonAtom variant='rect' width='100%' height={300} />
      </PublicLayoutComposition>
    );
  }
  // `initialData` makes TanStack infer a defined type, but the SSR initial
  // profile can legitimately be absent. Keep the runtime guard typed.
  const salonProfile: SalonProfileData | undefined = query.data;
  if (!salonProfile) {
    return (
      <PublicLayoutComposition>
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={t('retry')}
          onRetry={() => void query.refetch()}
          isRetrying={query.isFetching}
        />
      </PublicLayoutComposition>
    );
  }
  return (
    <SalonProfileBody
      profile={salonProfile}
      encodedPhone={
        salonProfile.contact.phone
          ? encodePii(salonProfile.contact.phone)
          : encodedPhone
      }
    />
  );
}
function SalonProfileBody({
  profile,
  encodedPhone,
}: {
  profile: SalonProfileData;
  encodedPhone: string | null;
}) {
  const t = useTranslations('salon.profile');
  const tLabels = useTranslations('labels');
  const account = {
    account_id: profile.account_id,
    display_name: profile.name,
    business_name: null,
    address_city: profile.contact.address_city,
    address_street: readAddressStreet(profile.contact),
    address_country: null,
    phone: null,
    website: profile.contact.website,
    description: null,
    vanity_url: null,
    view_count: 0,
    instagram_handle: profile.contact.instagram_handle,
    avatar_url: profile.logo_url ?? null,
    brand_accent_color: profile.brand_accent_color,
    effective_pricing_plan: profile.effective_pricing_plan ?? null,
    latitude: null,
    longitude: null,
  };
  return (
    <PublicLayoutComposition>
      <div
        {...brandScopeProps(
          profile.brand_accent_color,
          `${styles.page} ${salonStyles.content}`
        )}>
        <StylistProfileHeaderOrganism
          account={account}
          identityKind='salon'
          isPaired={false}
          onUnpairRequest={() => undefined}
        />
        <section className={salonStyles.section}>
          <TypographyAtom>{t('connectBody')}</TypographyAtom>
          <LinkButtonAtom
            variant='primary'
            href={buildRoute(ROUTES_FRONT.STYLIST_PROFILE, {
              identifier: profile.owner.identifier,
            })}>
            {t('connectSalon')}
          </LinkButtonAtom>
        </section>
        <section className={salonStyles.section}>
          <TypographyAtom variant='h2' as='h2'>
            {t('owner')}
          </TypographyAtom>
          <NavRowListMolecule>
            <Person person={profile.owner} role={t('ownerRole')} />
          </NavRowListMolecule>
        </section>
        {profile.members.length > 0 && (
          <section className={salonStyles.section}>
            <TypographyAtom variant='h2' as='h2'>
              {t('team')}
            </TypographyAtom>
            <NavRowListMolecule>
              {profile.members.map(person => (
                <Person
                  key={person.account_id}
                  person={person}
                  role={t('stylistRole')}
                />
              ))}
            </NavRowListMolecule>
          </section>
        )}
        <section className={salonStyles.section}>
          <TypographyAtom variant='h2' as='h2'>
            {t('works')}
          </TypographyAtom>
          {profile.works.length === 0 ? (
            <TypographyAtom>{t('emptyWorks')}</TypographyAtom>
          ) : (
            <div className={manageStyles.galleryWorks}>
              {profile.works.map(work => (
                <GalleryPhotoCardOrganism
                  key={work.gallery_record_id}
                  record={{
                    gallery_record_id: work.gallery_record_id,
                    asset_url: work.asset_url,
                    is_pinned: false,
                    colors: [],
                    traits: [],
                    created_at: '',
                  }}
                  {...(work.author && {
                    footer: (
                      <AppLinkAtom
                        href={buildRoute(ROUTES_FRONT.STYLIST_PROFILE, {
                          identifier: work.author.identifier,
                        })}
                        className={manageStyles.workAuthor}>
                        {work.author.name || tLabels('stylistFallback')}
                      </AppLinkAtom>
                    ),
                  })}
                />
              ))}
            </div>
          )}
        </section>
        <SalonGalleryOrganism
          salonAccountId={profile.account_id}
          publicOnly
          excludeIds={profile.works.map(work => work.gallery_record_id)}
        />
        <StylistProfileContactMolecule
          encodedPhone={encodedPhone}
          website={profile.contact.website}
          instagramHandle={profile.contact.instagram_handle}
          externalLinks={profile.contact.external_links ?? []}
        />
      </div>
    </PublicLayoutComposition>
  );
}
