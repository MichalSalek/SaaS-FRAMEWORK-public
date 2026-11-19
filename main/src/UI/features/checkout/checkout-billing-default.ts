import type { StripeCheckoutContact } from '@stripe/stripe-js';
import type { CountryCode } from '@kernel/domain/localization/country.config';
import type { BillingProfile } from '@kernel/domain/account/billing-profile.contract-schemas';

/** A saved billing address takes precedence over the detected country hint. */
export function checkoutBillingDefault(
  country?: CountryCode,
  profile?: BillingProfile
): StripeCheckoutContact | undefined {
  const savedCountry = profile?.country;
  const defaultCountry = savedCountry ?? country;
  if (!defaultCountry) {
    return undefined;
  }
  if (!savedCountry) {
    return { address: { country: defaultCountry } };
  }
  return {
    ...(profile.company_name ? { name: profile.company_name } : {}),
    address: {
      country: savedCountry,
      ...(profile.address_line1 != null && { line1: profile.address_line1 }),
      ...(profile.address_line2 != null && { line2: profile.address_line2 }),
      ...(profile.address_city != null && { city: profile.address_city }),
      ...(profile.address_postal_code != null && {
        postal_code: profile.address_postal_code,
      }),
      ...(profile.address_state != null && { state: profile.address_state }),
    },
  };
}
