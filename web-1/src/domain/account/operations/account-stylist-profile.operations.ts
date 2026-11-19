// account-stylist-profile.operations.ts
// DECISION: section writes share one transaction. Geocoding runs before locks; the merged address
// is checked again under the owner lock. Audit delivery stays best effort after commit.
// The handler derives account_id from currentUser through requireStylistAccount.

import { DB_CLIENT } from '@app/db/db.client';
import { Prisma } from '../../../prisma/js-client';
import { prepareStylistProfileLocation_IO } from './account-profile-location.operations';
import { isP2025 } from '@app/db/prisma-error';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { writeRawEventLog_IO } from '@app/event-log/event-log.client';
import { VALIDATION_MESSAGES } from '@kernel/domain/i18n/validation.i18n';
import { reconcileAddressWrite } from './account-address-write.helpers';
import { lockStylistAccount } from '@app/db/lock-rows';
import type { IDType } from '@kernel/application/application.types';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import type { StylistAccount } from '@kernel/models/db_models.generated.dto';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import { hasCode, narrowStylistAccount } from '@kernel/models/type_narrowing';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  AccountNotFoundError,
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type {
  AccountVanityUrlTakenError,
  AccountVanityUrlReservedError,
} from '@kernel/domain/user-and-account/account-errors.types';
import { RESERVED_VANITY_URLS } from '@kernel/domain/user-and-account/vanity-url.config';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type { BrandingPlanLockedError } from '@kernel/domain/user-and-account/account-errors.types';
import { getPlanConfig } from '@app/pricing/plan-config.cache';
import {
  claimProfileLink,
  isProfileLinkReservedByOther,
} from '../profile-link-alias.operations';

type Request = ACCOUNT_DTO_API_V1['UPDATE_STYLIST_PROFILE']['REQUEST'];
type SectionLabel =
  'location' | 'bio' | 'vanity' | 'social' | 'links' | 'branding';

export type UpdateStylistProfileResult = {
  account: StylistAccount;
  updated_sections: SectionLabel[];
};

export const accountUpdateStylistProfile_IO = async ({
  account_id,
  created_by_user_id,
  stylist_pricing_plan,
  body,
}: {
  account_id: IDType;
  created_by_user_id: IDType;
  stylist_pricing_plan: PricingPlan;
  body: Request;
}): Promise<
  OperationResult<
    UpdateStylistProfileResult,
    | AccountNotFoundError
    | AccountVanityUrlTakenError
    | AccountVanityUrlReservedError
    | BrandingPlanLockedError
    | ValidationError
    | DatabaseError
  >
> => {
  const updatedSections: SectionLabel[] = [];

  // ─── PRE-FLIGHT: vanity (uniqueness + reserved words) ─────────────────────
  let normalizedVanity: string | null | undefined;
  if (body.vanity) {
    const v = body.vanity.vanity_url;
    if (v !== null && v !== undefined) {
      if (RESERVED_VANITY_URLS.includes(v.toLowerCase())) {
        return failure({
          type: 'ACCOUNT_VANITY_URL_RESERVED',
          vanityUrl: v,
        });
      }

      let existing;
      let reserved;
      try {
        [existing, reserved] = await Promise.all([
          DB_CLIENT.use.stylistAccount.findFirst({
            where: { OR: [{ vanity_url: v }, { account_id: v }] },
            select: { account_id: true },
          }),
          isProfileLinkReservedByOther(DB_CLIENT.use, {
            kind: 'STYLIST',
            slug: v,
            accountId: String(account_id),
          }),
        ]);
      } catch (error) {
        return databaseFailure('accountUpdateStylistProfile_IO', error);
      }
      if (reserved || (existing && existing.account_id !== account_id)) {
        return failure({
          type: 'ACCOUNT_VANITY_URL_TAKEN',
          vanityUrl: v,
        });
      }
    }
    normalizedVanity = v ?? null;
  }

  const preparedLocation = await prepareStylistProfileLocation_IO(
    String(account_id),
    body.location
  );
  if (!preparedLocation.success) {
    return preparedLocation;
  }
  const { addressInput, geocoded, fields } = preparedLocation.data;
  const locationUpdate = Object.keys(fields).length > 0 ? fields : undefined;

  // ─── PRE-FLIGHT: bio (the public „O mnie” text alone, no city needed) ─────
  // A blank text clears the column, like `location.description` does. When both
  // sections arrive, `bio` is written last and wins (it is the explicit one).
  let bioUpdate: { description: string | null } | undefined;
  if (body.bio) {
    const raw = body.bio.description;
    bioUpdate = {
      description: raw && raw.trim() !== '' ? raw.trim() : null,
    };
  }

  // ─── PRE-FLIGHT: social (sanitize instagram_handle) ───────────────────────
  let socialUpdate: { instagram_handle: string | null } | undefined;
  if (body.social) {
    const ig = body.social.instagram_handle;
    if (ig !== undefined) {
      const sanitized = ig === null || ig.trim() === '' ? null : ig.trim();
      socialUpdate = { instagram_handle: sanitized };
    }
  }

  // ─── PRE-FLIGHT: external links (max 3, https) ────────────────────────────
  let linksUpdate: { external_links: string[] | null } | undefined;
  if (body.links) {
    const links = body.links.external_links;
    if (links !== undefined) {
      linksUpdate = {
        external_links:
          links === null || links.length === 0
            ? null
            : links.map(link => link.trim()),
      };
    }
  }

  // ─── PRE-FLIGHT: branding (gate planu — Pro Marka+) ───────────────────────
  // Wartość zwalidowana kernelem (kolor ∈ kuratorowana paleta albo null);
  // tu egzekwujemy WYŁĄCZNIE uprawnienie planu (can_brand_profile). Free/Pro
  // dostają 403 zamiast cichego zapisu — cennik obiecuje branding od Pro Marka.
  let brandingUpdate: { brand_accent_color: string | null } | undefined;
  if (body.branding) {
    const planConfig = await getPlanConfig(stylist_pricing_plan);
    if (!planConfig.can_brand_profile) {
      return failure({
        type: 'BRANDING_PLAN_LOCKED',
        accountId: String(account_id),
      });
    }
    brandingUpdate = { brand_accent_color: body.branding.brand_accent_color };
  }

  // ─── ATOMIC TRANSACTION ───────────────────────────────────────────────────
  // All dirty sections share the final update after locked address validation.
  let updated;
  try {
    updated = await DB_CLIENT.use.$transaction(async tx => {
      const data: Parameters<typeof tx.stylistAccount.update>[0]['data'] = {};

      // The previous slug must be read after the same owner lock used by
      // competing saves; otherwise A→B and A→C can both retire A and lose B.
      if (addressInput || normalizedVanity !== undefined) {
        await lockStylistAccount(tx, String(account_id));
      }
      if (locationUpdate) {
        Object.assign(data, locationUpdate);
      }
      if (addressInput) {
        const currentAddress = await tx.stylistAccount.findUnique({
          where: { account_id },
        });
        const fresh = reconcileAddressWrite(
          addressInput,
          currentAddress,
          geocoded
        );
        if (!fresh.ok) {
          throw new Error('PROFILE_ADDRESS_CITY');
        }
        Object.assign(data, fresh.patch);
      }
      if (bioUpdate) {
        data.description = bioUpdate.description;
      }
      if (normalizedVanity !== undefined) {
        data.vanity_url = normalizedVanity;
        const before = await tx.stylistAccount.findUnique({
          where: { account_id },
          select: { vanity_url: true },
        });
        await claimProfileLink(tx, {
          kind: 'STYLIST',
          accountId: String(account_id),
          previousSlug: before?.vanity_url ?? null,
          nextSlug: normalizedVanity,
        });
      }
      if (socialUpdate) {
        data.instagram_handle = socialUpdate.instagram_handle;
      }
      if (linksUpdate) {
        data.external_links =
          linksUpdate.external_links && linksUpdate.external_links.length > 0
            ? linksUpdate.external_links
            : Prisma.DbNull;
      }
      if (brandingUpdate) {
        data.brand_accent_color = brandingUpdate.brand_accent_color;
      }

      // Guard: if validator passed but every sub-section was a no-op, return current
      // state without writing. Defensive — validator already enforces hasAny.
      if (Object.keys(data).length === 0) {
        const current = await tx.stylistAccount.findUnique({
          where: { account_id },
        });
        if (!current) {
          throw Object.assign(new Error('ACCOUNT_NOT_FOUND'), {
            code: 'P2025',
          });
        }
        return current;
      }

      return tx.stylistAccount.update({
        where: { account_id },
        data,
      });
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'PROFILE_ADDRESS_CITY') {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'location',
        message: VALIDATION_MESSAGES.location.cityRequired,
      });
    }
    if (isP2025(error)) {
      return failure({
        type: 'ACCOUNT_NOT_FOUND',
        accountId: String(account_id),
      });
    }
    if (hasCode(error) && error.code === 'P2002') {
      // Race: someone else claimed the vanity between pre-check and write
      return failure({
        type: 'ACCOUNT_VANITY_URL_TAKEN',
        vanityUrl: normalizedVanity ?? '',
      });
    }
    return databaseFailure('accountUpdateStylistProfile_IO', error);
  }

  const narrowed = narrowStylistAccount(
    updated,
    'accountUpdateStylistProfile_IO'
  );
  if (!narrowed) {
    return failure({
      type: 'ACCOUNT_NOT_FOUND',
      accountId: String(account_id),
    });
  }

  if (locationUpdate) {
    updatedSections.push('location');
  }
  if (bioUpdate) {
    updatedSections.push('bio');
  }
  if (normalizedVanity !== undefined) {
    updatedSections.push('vanity');
  }
  if (socialUpdate) {
    updatedSections.push('social');
  }
  if (linksUpdate) {
    updatedSections.push('links');
  }
  if (brandingUpdate) {
    updatedSections.push('branding');
  }

  if (locationUpdate) {
    void writeRawEventLog_IO({
      eventName: APP_EVENTS.INFO.ACCOUNT.ACCOUNT_LOCATION_SET,
      eventLogType: EventLogTypeValue.ACCOUNT,
      meta: { created_by_user_id: String(created_by_user_id) },
      eventPayloadToStringify: {
        account_id: narrowed.account_id,
        city: narrowed.address_city,
        coordinates: { lat: narrowed.latitude, lon: narrowed.longitude },
        updated_at: new Date(),
      },
    });
  }
  if (normalizedVanity !== undefined) {
    void writeRawEventLog_IO({
      eventName: APP_EVENTS.INFO.ACCOUNT.VANITY_URL_SET,
      eventLogType: EventLogTypeValue.ACCOUNT,
      meta: { created_by_user_id: String(created_by_user_id) },
      eventPayloadToStringify: {
        account_id: narrowed.account_id,
        vanity_url: narrowed.vanity_url,
        updated_at: new Date(),
      },
    });
  }
  if (brandingUpdate) {
    void writeRawEventLog_IO({
      eventName: APP_EVENTS.INFO.ACCOUNT.BRAND_ACCENT_SET,
      eventLogType: EventLogTypeValue.ACCOUNT,
      meta: { created_by_user_id: String(created_by_user_id) },
      eventPayloadToStringify: {
        account_id: narrowed.account_id,
        brand_accent_color: narrowed.brand_accent_color,
        updated_at: new Date(),
      },
    });
  }
  if (socialUpdate) {
    void writeRawEventLog_IO({
      eventName: APP_EVENTS.INFO.ACCOUNT.STYLIST_SOCIAL_LINKS_UPDATED,
      eventLogType: EventLogTypeValue.ACCOUNT,
      meta: { created_by_user_id: String(created_by_user_id) },
      eventPayloadToStringify: {
        account_id: narrowed.account_id,
        instagram_handle: narrowed.instagram_handle,
        updated_at: new Date(),
      },
    });
  }

  return success({
    account: narrowed,
    updated_sections: updatedSections,
  });
};
