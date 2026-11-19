// Autosave handlers of the personal profile.
//
// DECISION: ZERO local onSuccess toast. Success is signalled by the http interceptor
// (onSuccessMainInterceptor → event-bus Stage 1 → snackbar STYLIST_PROFILE_UPDATED); a local push
// would be a SECOND toast of the same event, today silenced only by a fragile message dedup.
// onError lives in the hook (suppressGlobalError + a specific toast): TQ v5 fires BOTH levels, so
// a local duplicate gave two snackbars on one error.
//
// Saves are per API SECTION on leaving a field, ONLY when the section is dirty. They are
// single-flight with a queue per section (see useSingleFlightSaves).

import type { CountryCode } from '@kernel/domain/localization/country.config';
import { sanitizeExternalLinks } from '@kernel/domain/user-and-account/external-links.config';
import type { SafeStylistAccountWire } from '@kernel/domain/user/user.contract-schemas';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import {
  normalizeInstagramHandle,
  normalizeWebsiteUrl,
} from '../../shared/profile/profile-input.helpers';
import type { StylistProfileSaveSection } from './StylistProfileSaveLine.molecule';

type UpdateRequest = ACCOUNT_DTO_API_V1['UPDATE_STYLIST_PROFILE']['REQUEST'];
type SaveSection = StylistProfileSaveSection;

export function useStylistProfileFieldSaves({
  stylistAccount,
  businessNameDirty,
  locationDirty,
  contactFieldsDirty,
  salonName,
  country,
  city,
  street,
  phone,
  website,
  instagram,
  vanityUrl,
  setters,
  saves,
}: {
  stylistAccount: SafeStylistAccountWire;
  businessNameDirty: boolean;
  locationDirty: boolean;
  contactFieldsDirty: boolean;
  salonName: string;
  country: CountryCode | '';
  city: string;
  street: string;
  phone: string;
  website: string;
  instagram: string;
  vanityUrl: string;
  setters: {
    setWebsite: (value: string) => void;
    setVanityUrl: (value: string) => void;
    setInstagram: (value: string) => void;
    setLinks: (value: string[]) => void;
    setAccentColor: (value: string) => void;
  };
  saves: {
    save: (section: SaveSection, request: UpdateRequest) => void;
    discard: (section: SaveSection) => void;
    isBusy: (section: SaveSection) => boolean;
  };
}) {
  const { save, discard, isBusy } = saves;

  // A field returned to its saved value means a failed snapshot of the section is nobody's intent
  // any more and a retry must not resurrect it. Exception: when this section's snapshot is still in
  // flight, the revert must be SENT (see useSingleFlightSaves), otherwise the in-flight value wins.
  const saveBusinessName = () => {
    if (!businessNameDirty && !isBusy('identity')) {
      discard('identity');
      return;
    }
    save('identity', {
      location: { business_name: salonName.trim() || null },
    });
  };

  const saveLocation = (nextCountry: CountryCode | '' = country) => {
    const streetNeedsCity = street.trim() !== '' && city.trim() === '';
    if (streetNeedsCity) {
      return;
    }
    if (!locationDirty && nextCountry === country && !isBusy('location')) {
      discard('location');
      return;
    }
    save('location', {
      location: {
        address_country: nextCountry || null,
        address_city: city.trim() || null,
        address_street: street.trim() || null,
      },
    });
  };

  const saveContact = () => {
    const nextWebsite = normalizeWebsiteUrl(website);
    if (nextWebsite !== website) {
      setters.setWebsite(nextWebsite);
    }
    const dirty =
      contactFieldsDirty || nextWebsite !== (stylistAccount.website ?? '');
    if (!dirty && !isBusy('contact')) {
      discard('contact');
      return;
    }
    save('contact', {
      location: {
        phone: phone.trim() || null,
        website: nextWebsite || null,
      },
    });
  };

  const saveVanity = () => {
    // Profile address: the server accepts only [a-z0-9-], so edge spaces vanish here and capitals
    // already while typing.
    const next = vanityUrl.trim();
    if (next !== vanityUrl) {
      setters.setVanityUrl(next);
    }
    if (next === (stylistAccount.vanity_url ?? '') && !isBusy('vanity')) {
      discard('vanity');
      return;
    }
    save('vanity', { vanity: { vanity_url: next || null } });
  };

  const saveInstagram = () => {
    // Same normalisation as in onboarding: "@anna.nails" and a pasted profile link save as the bare
    // account name.
    const next = normalizeInstagramHandle(instagram);
    if (next !== instagram) {
      setters.setInstagram(next);
    }
    if (next === (stylistAccount.instagram_handle ?? '') && !isBusy('social')) {
      discard('social');
      return;
    }
    save('social', { social: { instagram_handle: next || null } });
  };

  const saveLinks = (next: string[]) => {
    const normalized = sanitizeExternalLinks(next);
    setters.setLinks(normalized);
    if (
      JSON.stringify(normalized) ===
        JSON.stringify(sanitizeExternalLinks(stylistAccount.external_links)) &&
      !isBusy('links')
    ) {
      discard('links');
      return;
    }
    save('links', { links: { external_links: normalized } });
  };

  // Swatch = save at once with the CLICKED value (state is asynchronous).
  const saveAccent = (hex: string) => {
    setters.setAccentColor(hex);
    if (
      hex === (stylistAccount.brand_accent_color ?? '') &&
      !isBusy('branding')
    ) {
      discard('branding');
      return;
    }
    save('branding', { branding: { brand_accent_color: hex || null } });
  };

  return {
    saveBusinessName,
    saveLocation,
    saveContact,
    saveVanity,
    saveInstagram,
    saveLinks,
    saveAccent,
  };
}
