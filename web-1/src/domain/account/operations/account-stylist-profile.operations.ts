// account-stylist-profile.operations.ts
// D5 (run 25 TRD): atomic consolidated update of stylist profile (location + vanity + social).
//
// DECISION (nie usuwaj tego komentarza):
// All three sub-section updates run inside a single Prisma $transaction. Either every
// requested sub-section persists, or none of them — no partial state. Pre-checks
// (vanity uniqueness/reserved-words, geocoding for new addresses) execute BEFORE the
// transaction so a failure short-circuits without holding row locks. Per-section audit
// events are emitted AFTER commit (fire-and-forget) — losing an audit row is acceptable;
// losing the profile mutation atomicity is not.
//
// SECURITY: account_id is derived from currentUser via requireStylistAccount() at the
// handler boundary — never read from request body (IDOR class).

import { DB_CLIENT } from '@app/db/db.client';
import { isP2025 } from '@app/db/prisma-error';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { writeRawEventLog_IO } from '@app/event-log/event-log.client';
import { geocodeAddress } from '@app/maps/geocoding.utils';
import type { IDType } from '@kernel/application/application.types';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import type { StylistAccount } from '@kernel/models/db_models.generated.dto';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import { hasCode, narrowStylistAccount } from '@kernel/models/type_narrowing';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';
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

type Request = ACCOUNT_DTO_API_V1['UPDATE_STYLIST_PROFILE']['REQUEST'];
type SectionLabel = 'location' | 'vanity' | 'social' | 'branding';

/**
 * Normalizes the optional stylist website field and enforces the https:// scheme
 * allowlist (defense-in-depth). Whitespace is stripped first (preserving the prior
 * normalize behaviour for this field); the result is then validated against the kernel
 * scheme allowlist. Anything that is not a well-formed https:// URL (javascript:, data:,
 * vbscript:, file:, http:, credentials-embedded, unparseable, over-length) collapses to
 * null — fail-closed, so an executable/phishing URI can never be persisted.
 */
const normalizeOptionalHttpsWebsite = (
  raw: string | null | undefined
): string | null => {
  if (!raw) {
    return null;
  }
  const normalized =
    VALIDATION_POLICY.utils.normalizeStringEliminateWhitespaces(raw);
  if (
    !VALIDATION_POLICY.utils.validateOptionalHttpsUrl(
      normalized,
      VALIDATION_LENGTHS.WEBSITE_MAX
    )
  ) {
    return null;
  }
  return normalized;
};

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
      // DECISION (nie usuwaj tego komentarza), s34 HIGH: a vanity lives in the
      // SAME namespace as account ids — the public profile, its share link and
      // every printed QR resolve `/stylist/<identifier>` by either. A vanity
      // equal to ANOTHER stylist's account_id let a rival shadow her profile and
      // receive the pairing requests her clients sent by scanning her QR (the
      // lookup took whichever row came first). The resolver now prefers the id,
      // and a vanity may not name someone else's account in the first place.
      let existing;
      try {
        existing = await DB_CLIENT.use.stylistAccount.findFirst({
          where: { OR: [{ vanity_url: v }, { account_id: v }] },
          select: { account_id: true },
        });
      } catch (error) {
        return databaseFailure('accountUpdateStylistProfile_IO', error);
      }
      if (existing && existing.account_id !== account_id) {
        return failure({
          type: 'ACCOUNT_VANITY_URL_TAKEN',
          vanityUrl: v,
        });
      }
    }
    normalizedVanity = v ?? null;
  }

  // ─── PRE-FLIGHT: location (normalize + geocode BEFORE transaction) ────────
  type LocationUpdate = {
    business_name: string | null;
    address_street: string | null;
    address_city: string;
    address_postal_code: string | null;
    address_country: string;
    phone: string | null;
    website: string | null;
    description: string | null;
    latitude?: number;
    longitude?: number;
  };
  let locationUpdate: LocationUpdate | undefined;
  if (body.location) {
    const loc = body.location;
    const normalized = {
      business_name: loc.business_name
        ? VALIDATION_POLICY.utils.normalizeStringCapitalizedWords(
            loc.business_name
          )
        : null,
      address_street: loc.address_street
        ? VALIDATION_POLICY.utils.normalizeStringCapitalizedWords(
            loc.address_street
          )
        : null,
      address_city: VALIDATION_POLICY.utils.normalizeStringCapitalizedWords(
        loc.address_city
      ),
      address_postal_code: loc.address_postal_code
        ? VALIDATION_POLICY.utils.normalizeStringEliminateWhitespaces(
            loc.address_postal_code
          )
        : null,
      address_country: loc.address_country || 'Poland',
      phone: loc.phone
        ? VALIDATION_POLICY.utils.normalizeStringEliminateWhitespaces(loc.phone)
        : null,
      // DECISION (nie usuwaj tego komentarza):
      // Defense-in-depth scheme gate. The website field MUST be an https:// URL —
      // javascript:/data:/vbscript:/file: etc. are rejected (fail-closed → null) so an
      // executable/phishing URI never reaches storage and can never be served verbatim in
      // the unauthenticated public-profile response (latent stored-XSS sink the moment any
      // UI renders website as an <a href>). Reuses the kernel scheme allowlist
      // (validateOptionalHttpsUrl, same helper used by admin-traits icon_url) — single SoT
      // for the allowlist, no parallel regex. The kernel validator (account.validation.ts)
      // is still length-only; hardening it to reject at the boundary is tracked separately
      // (needsKernel) — this normalize guard holds regardless of validator outcome.
      website: normalizeOptionalHttpsWebsite(loc.website),
      description: loc.description || null,
    };

    // Geocode TYLKO gdy realnie zmienił się ADRES (miasto/ulica/kod/kraj) —
    // zapis bio/nazwy salonu nie może zależeć od zewnętrznego serwisu map.
    // Fail geokodowania NIE blokuje zapisu (bug ownera 2026-07-12: „wpisałem
    // miasto, nie zapisało się" — Nominatim-null ubijał CAŁĄ sekcję): miasto
    // zapisuje się zawsze, współrzędne aktualizują się gdy geocode odpowie
    // (degradacja: mapa/geo zostają na starych/null do następnego zapisu).
    const currentAddress = await DB_CLIENT.use.stylistAccount.findUnique({
      where: { account_id },
      select: {
        address_street: true,
        address_city: true,
        address_postal_code: true,
        address_country: true,
      },
    });
    const addressChanged =
      !currentAddress ||
      currentAddress.address_street !== normalized.address_street ||
      currentAddress.address_city !== normalized.address_city ||
      currentAddress.address_postal_code !== normalized.address_postal_code ||
      currentAddress.address_country !== normalized.address_country;

    let geo: Awaited<ReturnType<typeof geocodeAddress>> = null;
    if (addressChanged) {
      geo = await geocodeAddress({
        street: normalized.address_street,
        city: normalized.address_city,
        postal_code: normalized.address_postal_code,
        country: normalized.address_country,
      });
    }

    locationUpdate = {
      ...normalized,
      ...(geo ? { latitude: geo.latitude, longitude: geo.longitude } : {}),
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
  // Combined update: one writes all dirty fields. Single round-trip to DB,
  // atomic by construction (one row, one statement).
  let updated;
  try {
    updated = await DB_CLIENT.use.$transaction(async tx => {
      const data: Parameters<typeof tx.stylistAccount.update>[0]['data'] = {};

      if (locationUpdate) {
        Object.assign(data, locationUpdate);
      }
      if (normalizedVanity !== undefined) {
        data.vanity_url = normalizedVanity;
      }
      if (socialUpdate) {
        data.instagram_handle = socialUpdate.instagram_handle;
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
  if (normalizedVanity !== undefined) {
    updatedSections.push('vanity');
  }
  if (socialUpdate) {
    updatedSections.push('social');
  }
  if (brandingUpdate) {
    updatedSections.push('branding');
  }

  // ─── POST-COMMIT AUDIT EVENTS (per-section, granular) ─────────────────────
  // Fire-and-forget: losing an audit row is acceptable per CLAUDE.md (EventLog dedup);
  // losing the mutation is not. Per-section events preserve granular timeline in
  // User Activity Log so user sees individual "Location set" / "Vanity URL set" entries.
  // The wrapper STYLIST_PROFILE_UPDATED is emitted by the handler via recordAuditEvent_IO.
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
