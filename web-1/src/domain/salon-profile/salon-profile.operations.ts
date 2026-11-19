import { personAvatarSources } from '@kernel/domain/user/avatar.policy';
import {
  salonDisplayName,
  stylistDisplayName,
} from '@kernel/domain/salon-profile/salon-names';
import { checkSalonSlug_IO } from './salon-slug.operations';
export { checkSalonSlug_IO } from './salon-slug.operations';
export { getStylistSalonLink_IO } from './salon-profile-link.operations';
import { getSalonContributors_IO } from '@domain/salon-gallery/salon-gallery.operations';
import { slugifyVanityBase } from '@domain/account/vanity-url.auto';
import { claimProfileLink } from '@domain/account/profile-link-alias.operations';
import { getEffectivePricingPlan } from '@kernel/domain/pricing/effective-plan';
import { hasCode } from '@kernel/models/type_narrowing';
import { lockStylistAccount } from '@app/db/lock-rows';
import { DB_CLIENT } from '@app/db/db.client';
import { Prisma } from '../../prisma/js-client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import {
  success,
  failure,
  type OperationResult,
} from '@kernel/application/result.types';
import type {
  AccountNotFoundError,
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import type {
  SalonProfileData,
  SALON_PROFILE_DTO_API_V1,
} from '@kernel/models/salon-profile/salon-profile.dto';
import {
  PRICING_POLICY,
  narrowPricingPlan,
} from '@kernel/policies/pricing.policy';
import { STYLIST_PUBLICLY_VISIBLE } from '@domain/account/account.config';
import { canManageSalonProfile } from './salon-profile.policy';
import { sanitizeExternalLinks } from '@kernel/domain/user-and-account/external-links.config';
import { geocodeAddress } from '@app/maps/geocoding.utils';
import { VALIDATION_MESSAGES } from '@kernel/domain/i18n/validation.i18n';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';
import { validateSalonShowcasePins } from './salon-profile-pins.helpers';
import {
  addressSectionFrom,
  planAddressWrite,
  reconcileAddressWrite,
} from '@domain/account/operations/account-address-write.helpers';

type ProfileResult = OperationResult<
  SalonProfileData,
  AccountNotFoundError | DatabaseError | ValidationError
>;
export async function getSalonProfile_IO({
  accountId,
  management = false,
  slug = false,
}: {
  accountId: string;
  management?: boolean;
  slug?: boolean;
}): Promise<ProfileResult> {
  try {
    const owner = await DB_CLIENT.use.stylistAccount.findFirst({
      where: {
        ...(slug ? { salon_vanity_url: accountId } : { account_id: accountId }),
        ...(!management ? STYLIST_PUBLICLY_VISIBLE : {}),
        created_by_user: { is_active: true, disabled_at: null },
      },
      include: {
        created_by_user: { select: { image: true, avatar_url: true } },
      },
    });
    if (
      !owner ||
      (!management && !canManageSalonProfile(owner)) ||
      (!management && !owner.salon_profile_name)
    ) {
      return failure({ type: 'ACCOUNT_NOT_FOUND', accountId });
    }
    accountId = owner.account_id;
    const limit =
      PRICING_POLICY.LIMITS[narrowPricingPlan(owner.pricing_plan)]
        .max_pinned_records;
    const team = await getSalonContributors_IO(accountId, management);
    if (!team) {
      return failure({ type: 'ACCOUNT_NOT_FOUND', accountId });
    }
    const contributors = team.contributors.map(person => person.account_id);
    const works = await DB_CLIENT.use.galleryRecord.findMany({
      where: {
        created_by_account_id: { in: contributors },
        salon_showcase_works: { some: { salon_account_id: accountId } },
        is_hidden: false,
      },
      select: {
        gallery_record_id: true,
        asset_url: true,
        created_by_account_id: true,
      },
      orderBy: [{ created_at: 'desc' }, { gallery_record_id: 'desc' }],
      // Management must preserve saved selections after a downgrade. The validator
      // caps a saved showcase at 100; public reads still obey the current plan.
      take: management ? Math.max(limit, 100) : limit,
    });
    const members = owner.salon_show_team
      ? team.contributors.filter(person => person.account_id !== accountId)
      : [];
    const contact = {
      address_country: owner.address_country,
      address_city: owner.address_city,
      address_street: owner.address_street,
      website: owner.website,
      instagram_handle: owner.instagram_handle,
      external_links: sanitizeExternalLinks(owner.salon_external_links),
      phone: owner.phone,
    };
    const ownerPhotos = personAvatarSources(owner.created_by_user);
    return success({
      account_id: accountId,
      logo_url: owner.salon_logo_url,
      is_active: canManageSalonProfile(owner),
      name_configured: Boolean(owner.salon_profile_name),
      salon_vanity_url: owner.salon_vanity_url,
      suggested_slug: slugifyVanityBase(salonDisplayName(owner)),
      name: salonDisplayName(owner),
      brand_accent_color: owner.salon_brand_accent_color,
      effective_pricing_plan: getEffectivePricingPlan(owner),
      show_team: owner.salon_show_team,
      owner: {
        account_id: accountId,
        name: stylistDisplayName(owner),
        avatar_url: ownerPhotos[0] ?? null,
        avatar_fallback_url: ownerPhotos[1] ?? null,
        identifier: owner.vanity_url || accountId,
      },
      members,
      works: works.map(work => {
        const author = team.contributors.find(
          person => person.account_id === work.created_by_account_id
        );
        if (!author) {
          throw new Error('Missing salon showcase contributor');
        }
        return {
          gallery_record_id: work.gallery_record_id,
          asset_url: work.asset_url,
          author,
        };
      }),
      contact,
    });
  } catch (error) {
    return databaseFailure('getSalonProfile_IO', error);
  }
}
export async function updateSalonProfile_IO({
  accountId,
  body,
}: {
  accountId: string;
  body: SALON_PROFILE_DTO_API_V1['SALON_PROFILE_UPDATE']['REQUEST'];
}): Promise<ProfileResult> {
  try {
    const owner = await DB_CLIENT.use.stylistAccount.findUnique({
      where: { account_id: accountId },
    });
    if (!owner || !canManageSalonProfile(owner)) {
      return failure({ type: 'ACCOUNT_NOT_FOUND', accountId });
    }
    if (body.salon_vanity_url != null) {
      const availability = await checkSalonSlug_IO({
        accountId,
        slug: body.salon_vanity_url,
      });
      if (!availability.success) {
        return failure(availability.error);
      }
      if (!availability.data.available) {
        return failure({
          type: 'VALIDATION_ERROR',
          field: 'salon_vanity_url',
          message: 'Address unavailable',
        });
      }
    }
    const limit =
      PRICING_POLICY.LIMITS[narrowPricingPlan(owner.pricing_plan)]
        .max_pinned_records;
    if (body.pinned_record_ids && body.pinned_record_ids.length > limit) {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'pinned_record_ids',
        message: 'Plan pin limit exceeded',
      });
    }
    const addressPlan = planAddressWrite(addressSectionFrom(body.contact), {
      address_street: owner.address_street,
      address_city: owner.address_city,
      address_postal_code: owner.address_postal_code,
      address_country: owner.address_country,
    });
    // The preflight snapshot may be stale; validate the merged address under the row lock.
    const query = addressPlan.ok ? addressPlan.geocode : null;
    const geo = query ? await geocodeAddress(query) : null;
    const geocoded =
      geo && query
        ? { query, latitude: geo.latitude, longitude: geo.longitude }
        : null;
    await DB_CLIENT.use.$transaction(async tx => {
      // Lock the owner row so concurrent profile saves cannot merge pin selections.
      await lockStylistAccount(tx, accountId);
      const lockedOwner = await tx.stylistAccount.findUnique({
        where: { account_id: accountId },
      });
      if (!lockedOwner || !canManageSalonProfile(lockedOwner)) {
        throw new Error('SALON_OWNER_PLAN');
      }
      const fresh = reconcileAddressWrite(
        addressSectionFrom(body.contact),
        lockedOwner,
        geocoded
      );
      if (!fresh.ok) {
        throw new Error('SALON_ADDRESS_CITY');
      }
      const address = addressSectionFrom(body.contact);
      const street =
        'address_street' in fresh.patch
          ? fresh.patch.address_street
          : lockedOwner.address_street;
      const city =
        'address_city' in fresh.patch
          ? fresh.patch.address_city
          : lockedOwner.address_city;
      if (
        Object.keys(address).length > 0 &&
        street?.trim() &&
        (city?.trim().length ?? 0) < VALIDATION_LENGTHS.CITY_MIN
      ) {
        throw new Error('SALON_ADDRESS_CITY');
      }
      if (
        body.pinned_record_ids &&
        body.pinned_record_ids.length >
          PRICING_POLICY.LIMITS[narrowPricingPlan(lockedOwner.pricing_plan)]
            .max_pinned_records
      ) {
        throw new Error('SALON_PIN_LIMIT');
      }
      if (body.salon_vanity_url !== undefined) {
        await claimProfileLink(tx, {
          kind: 'SALON',
          accountId,
          previousSlug: lockedOwner.salon_vanity_url,
          nextSlug: body.salon_vanity_url,
        });
      }
      if (body.pinned_record_ids !== undefined) {
        await validateSalonShowcasePins(tx, accountId, body.pinned_record_ids);
      }
      await tx.stylistAccount.update({
        where: { account_id: accountId },
        data: {
          ...(body.salon_vanity_url !== undefined
            ? { salon_vanity_url: body.salon_vanity_url }
            : {}),
          ...(body.contact?.website !== undefined
            ? { website: body.contact.website?.trim() || null }
            : {}),
          ...(body.contact?.instagram_handle !== undefined
            ? {
                instagram_handle: body.contact.instagram_handle?.trim() || null,
              }
            : {}),
          ...(body.contact?.phone !== undefined
            ? { phone: body.contact.phone?.trim() || null }
            : {}),
          ...(body.contact?.external_links !== undefined
            ? {
                salon_external_links:
                  body.contact.external_links &&
                  body.contact.external_links.length > 0
                    ? body.contact.external_links
                    : Prisma.DbNull,
              }
            : {}),
          ...fresh.patch,
          ...(body.name !== undefined ? { salon_profile_name: body.name } : {}),
          ...(body.brand_accent_color !== undefined
            ? { salon_brand_accent_color: body.brand_accent_color }
            : {}),
          ...(body.show_team !== undefined
            ? { salon_show_team: body.show_team }
            : {}),
        },
      });
      if (body.pinned_record_ids !== undefined) {
        await tx.salonShowcaseWork.deleteMany({
          where: { salon_account_id: accountId },
        });
        if (body.pinned_record_ids.length) {
          await tx.salonShowcaseWork.createMany({
            data: body.pinned_record_ids.map(gallery_record_id => ({
              salon_account_id: accountId,
              gallery_record_id,
            })),
            skipDuplicates: true,
          });
        }
      }
    });
    return getSalonProfile_IO({ accountId, management: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'SALON_ADDRESS_CITY') {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'address_city',
        message: VALIDATION_MESSAGES.location.cityRequired,
      });
    }
    if (error instanceof Error && error.message === 'SALON_OWNER_PLAN') {
      return failure({ type: 'ACCOUNT_NOT_FOUND', accountId });
    }
    if (error instanceof Error && error.message === 'SALON_PIN_LIMIT') {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'pinned_record_ids',
        message: 'Plan pin limit exceeded',
      });
    }
    if (error instanceof Error && error.message === 'SALON_PIN_OWNERSHIP') {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'pinned_record_ids',
        message: 'Select works from contributing salon members',
      });
    }
    if (hasCode(error) && error.code === 'P2002') {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'salon_vanity_url',
        message: 'Address unavailable',
      });
    }
    return databaseFailure('updateSalonProfile_IO', error);
  }
}
export {
  getSalonProfileVisibility_IO,
  updateSalonProfileVisibility_IO,
} from './salon-profile-visibility.operations';
