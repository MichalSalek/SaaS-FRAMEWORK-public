import { DB_CLIENT } from '@app/db/db.client';
import { geocodeAddress } from '@app/maps/geocoding.utils';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { VALIDATION_MESSAGES as V } from '@kernel/domain/i18n/validation.i18n';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import type { StylistAccount } from '@kernel/models/db_models.generated.dto';
import type {
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import {
  failure,
  success,
  type OperationResult,
} from '@kernel/application/result.types';
import {
  addressSectionFrom,
  planAddressWrite,
  type AddressSection,
  type GeocodedAddress,
} from './account-address-write.helpers';

type Location =
  ACCOUNT_DTO_API_V1['UPDATE_STYLIST_PROFILE']['REQUEST']['location'];
type LocationFields = Partial<
  Pick<
    StylistAccount,
    | 'business_name'
    | 'phone'
    | 'website'
    | 'description'
    | 'address_city'
    | 'address_street'
    | 'address_postal_code'
    | 'address_country'
  >
>;
type PreparedLocation = {
  fields: LocationFields;
  addressInput: AddressSection | null;
  geocoded: GeocodedAddress | null;
};

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

/** Network work stays outside the write transaction; the caller revalidates under its owner lock. */
export async function prepareStylistProfileLocation_IO(
  accountId: string,
  location: Location
): Promise<OperationResult<PreparedLocation, DatabaseError | ValidationError>> {
  const fields: LocationFields = {};
  if (!location) {
    return success({ fields, addressInput: null, geocoded: null });
  }
  if (Object.hasOwn(location, 'business_name')) {
    fields.business_name = location.business_name
      ? VALIDATION_POLICY.utils.normalizeStringCapitalizedWords(
          location.business_name
        )
      : null;
  }
  if (Object.hasOwn(location, 'phone')) {
    fields.phone = location.phone
      ? VALIDATION_POLICY.utils.normalizeStringEliminateWhitespaces(
          location.phone
        )
      : null;
  }
  if (Object.hasOwn(location, 'website')) {
    fields.website = normalizeOptionalHttpsWebsite(location.website);
  }
  if (Object.hasOwn(location, 'description')) {
    fields.description = location.description || null;
  }
  const addressInput = addressSectionFrom(location);
  if (Object.keys(addressInput).length === 0) {
    return success({ fields, addressInput: null, geocoded: null });
  }
  try {
    const current = await DB_CLIENT.use.stylistAccount.findUnique({
      where: { account_id: accountId },
      select: {
        address_city: true,
        address_street: true,
        address_postal_code: true,
        address_country: true,
      },
    });
    const plan = planAddressWrite(addressInput, current);
    if (!plan.ok) {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'location',
        message: V.location.cityRequired,
      });
    }
    Object.assign(fields, plan.patch);
    const geo = plan.geocode ? await geocodeAddress(plan.geocode) : null;
    const geocoded =
      geo && plan.geocode
        ? {
            query: plan.geocode,
            latitude: geo.latitude,
            longitude: geo.longitude,
          }
        : null;
    return success({ fields, addressInput, geocoded });
  } catch (error) {
    return databaseFailure('prepareStylistProfileLocation_IO', error);
  }
}
