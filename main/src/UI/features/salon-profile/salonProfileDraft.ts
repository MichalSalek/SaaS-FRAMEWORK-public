import {
  normalizeCountryCode,
  type CountryCode,
} from '@kernel/domain/localization/country.config';
import type {
  SALON_PROFILE_DTO_API_V1,
  SalonProfileData,
} from '@kernel/models/salon-profile/salon-profile.dto';
import { sanitizeExternalLinks } from '@kernel/domain/user-and-account/external-links.config';
import { readAddressStreet } from '../stylist/_profile-address.helpers';
import {
  normalizeInstagramHandle,
  normalizeWebsiteUrl,
} from '../shared/profile/profile-input.helpers';
import type { KeyboardEvent } from 'react';

export function blurSalonInputOnEnter(
  event: KeyboardEvent<HTMLInputElement>
): void {
  if (event.key === 'Enter') {
    event.currentTarget.blur();
  }
}

export type SalonContactDraft = {
  address_country: CountryCode | '';
  address_city: string;
  address_street: string;
  website: string;
  instagram_handle: string;
  phone: string;
  external_links: string[];
};

export type SalonDraft = {
  contact: SalonContactDraft;
  slug: string;
  name: string;
  accent: string | null;
  showTeam: boolean;
  pins: string[];
};

export type SalonUpdateRequest =
  SALON_PROFILE_DTO_API_V1['SALON_PROFILE_UPDATE']['REQUEST'];

const contactDraft = (value: SalonProfileData): SalonDraft['contact'] => ({
  address_country: normalizeCountryCode(value.contact.address_country) ?? '',
  address_city: value.contact.address_city ?? '',
  address_street: readAddressStreet(value.contact) ?? '',
  website: value.contact.website ?? '',
  instagram_handle: value.contact.instagram_handle ?? '',
  phone: value.contact.phone ?? '',
  external_links: sanitizeExternalLinks(value.contact.external_links),
});

/** What the form starts with: saved values, else the suggested name and address. */
export const initialDraft = (value: SalonProfileData): SalonDraft => ({
  contact: contactDraft(value),
  slug: value.salon_vanity_url || value.suggested_slug || '',
  name: value.name,
  accent: value.brand_accent_color,
  showTeam: value.show_team,
  pins: value.works.map(work => work.gallery_record_id),
});

/** What is really saved: a suggested name or address is NOT saved. */
export const savedDraft = (value: SalonProfileData): SalonDraft => ({
  ...initialDraft(value),
  slug: value.salon_vanity_url || '',
  name: value.name_configured === false ? '' : value.name,
});

export const fingerprint = (draft: SalonDraft) =>
  JSON.stringify({ ...draft, pins: [...draft.pins].sort() });

/** The public salon page exists once a salon name is saved (backend gate). */
export const isPublished = (value: SalonProfileData) =>
  value.name_configured !== false;

/** Contact as it is stored: trimmed, the website made a full address, the
 *  Instagram handle as the account name (same rule as the personal profile),
 *  an empty field = null. */
export const normalizeSalonContact = (contact: SalonDraft['contact']) => ({
  address_country: contact.address_country || null,
  address_city: contact.address_city.trim() || null,
  address_street: contact.address_street.trim() || null,
  website: normalizeWebsiteUrl(contact.website) || null,
  instagram_handle: normalizeInstagramHandle(contact.instagram_handle) || null,
  phone: contact.phone.trim() || null,
  external_links: sanitizeExternalLinks(contact.external_links),
});

export function salonStreetNeedsCity(contact: SalonDraft['contact']): boolean {
  const normalized = normalizeSalonContact(contact);
  return normalized.address_street != null && normalized.address_city == null;
}

/** The whole snapshot the update endpoint takes. `slug` is the link she has
 *  committed to (never a half-typed one); empty = keep the salon on its id link. */
export const buildSalonUpdate = (
  draft: SalonDraft,
  slug: string
): SalonUpdateRequest => {
  const contact = normalizeSalonContact(draft.contact);
  return {
    name: draft.name.trim(),
    contact,
    salon_vanity_url: slug || null,
    brand_accent_color: draft.accent,
    show_team: draft.showTeam,
    pinned_record_ids: draft.pins,
  };
};

/** A published salon saves itself: does this snapshot differ from what the
 *  backend holds? Compared after normalisation, so leaving a field that only
 *  lost a trailing space sends nothing. */
export const differsFromSaved = (
  request: SalonUpdateRequest,
  saved: SalonProfileData
): boolean => {
  const base = buildSalonUpdate(
    savedDraft(saved),
    saved.salon_vanity_url ?? ''
  );
  const sorted = (value: SalonUpdateRequest) =>
    JSON.stringify({
      ...value,
      pinned_record_ids: [...(value.pinned_record_ids ?? [])].sort(),
    });
  return sorted(request) !== sorted(base);
};

export type SlugAvailability = 'checking' | 'available' | 'taken' | 'error';

/** What leaving the link field of a published salon does. */
export type SlugCommit = 'unchanged' | 'invalid' | 'wait' | 'save' | 'refuse';

export const decideSlugCommit = ({
  slug,
  savedSlug,
  valid,
  availability,
}: {
  slug: string;
  savedSlug: string;
  valid: boolean;
  availability: SlugAvailability;
}): SlugCommit => {
  if (slug === savedSlug) {
    return 'unchanged';
  }
  if (!valid) {
    return 'invalid';
  }
  if (availability === 'checking') {
    return 'wait';
  }
  return availability === 'available' ? 'save' : 'refuse';
};

/** The first configuration: a name and a free, valid link make it publishable;
 *  contact and colour are optional. */
export const canPublish = ({
  name,
  validSlug,
  availability,
}: {
  name: string;
  validSlug: boolean;
  availability: SlugAvailability;
}): boolean =>
  Boolean(name.trim()) && validSlug && availability === 'available';

/** Dirty indicators for the independent identity, address and contact boxes. */
export function salonDraftDirty(
  draft: SalonDraft,
  saved: SalonProfileData,
  slugPending: boolean,
  slugError: boolean
) {
  const a = normalizeSalonContact(draft.contact);
  const b = normalizeSalonContact(initialDraft(saved).contact);
  return {
    identity:
      (draft.name.trim() !== '' && draft.name.trim() !== saved.name) ||
      (slugPending && !slugError),
    location:
      a.address_country !== b.address_country ||
      a.address_city !== b.address_city ||
      a.address_street !== b.address_street,
    contact:
      a.phone !== b.phone ||
      a.website !== b.website ||
      a.instagram_handle !== b.instagram_handle,
  };
}
