import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../i18n/validation.i18n';
import {
  EXTERNAL_LINK_LIMIT,
  isValidExternalLink,
} from '../user-and-account/external-links.config';
import { isBrandAccentHex } from '../user-and-account/branding.config';
import { vanityUrlSchema } from '../user-and-account/vanity-url.config';
import {
  isValidPhoneNumber,
  VALIDATION_LENGTHS,
  VALIDATION_REGEX,
  VALIDATION_SOCIAL,
} from '../../policies/validation.config';
import {
  validateByMinLength,
  validateOptionalHttpsUrl,
  validateOptionalString,
} from '../../policies/validation/validation.utils';

const V = VALIDATION_MESSAGES;

// ── updateStylistProfile ───────────────────────────────────────────────────
// DECISION: this validator's REQUEST keys (`location`, `bio`, `vanity`, `social`, `branding`) differ
// from the FLAT error-DTO slots its clients and characterisation tests read (`location`,
// `description`, `vanity_url`, `instagram_handle`, `brand_accent_color`), so it runs through
// `zodValidateWithErrorSlots` with the slots declared below. The section fields are `z.custom` type
// carriers with no check of their own: the superRefine is the only gate (one issue per sub-field, the
// exact i18n keys), and a parse that succeeds has passed it, so the handler receives the typed
// sections. Unknown top-level keys are stripped ; inside a section the operation
// reads only named fields.
type StylistProfileLocation = {
  business_name?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_postal_code?: string | null;
  address_country?: string | null;
  phone?: string | null;
  website?: string | null;
  description?: string | null;
};
type StylistProfileBio = { description?: string | null };
type StylistProfileVanity = { vanity_url?: string | null };
type StylistProfileSocial = { instagram_handle?: string | null };
type StylistProfileLinks = { external_links?: string[] | null };
type StylistProfileBranding = { brand_accent_color: string | null };
type UpdateStylistProfileRequest = {
  location?: StylistProfileLocation;
  bio?: StylistProfileBio;
  vanity?: StylistProfileVanity;
  social?: StylistProfileSocial;
  links?: StylistProfileLinks;
  branding?: StylistProfileBranding;
};
export const UPDATE_STYLIST_PROFILE_ERROR_SLOTS = [
  'location',
  'description',
  'vanity_url',
  'instagram_handle',
  'external_links',
  'brand_accent_color',
] as const;
const UPDATE_STYLIST_PROFILE_SECTIONS: ReadonlyArray<
  readonly [
    keyof UpdateStylistProfileRequest,
    (typeof UPDATE_STYLIST_PROFILE_ERROR_SLOTS)[number],
    string,
  ]
> = [
  ['location', 'location', V.location.cityRequired],
  ['bio', 'description', V.location.descriptionTooLong],
  ['vanity', 'vanity_url', V.vanityUrl.invalidType],
  ['social', 'instagram_handle', V.social.instagramNotString],
  ['links', 'external_links', V.externalLinks.tooMany],
  ['branding', 'brand_accent_color', V.branding.invalidColor],
];
const isPlainSection = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
// A section carrier: no check of its own (the superRefine is the gate); `null` reads as an absent
// section, as it always did, so the handler never sees a null section.
const profileSection = <T>() =>
  z
    .custom<T | null>()
    .optional()
    .transform(value => value ?? undefined);
export const updateStylistProfileSchema = z
  .object({
    location: profileSection<StylistProfileLocation>(),
    bio: profileSection<StylistProfileBio>(),
    vanity: profileSection<StylistProfileVanity>(),
    social: profileSection<StylistProfileSocial>(),
    links: profileSection<StylistProfileLinks>(),
    branding: profileSection<StylistProfileBranding>(),
  })
  .superRefine((val, ctx) => {
    // The carriers above assert the section types; the checks below are what makes them true,
    // so every section is read as untrusted `unknown` here.
    const typedData: Record<keyof UpdateStylistProfileRequest, unknown> = {
      location: val.location,
      bio: val.bio,
      vanity: val.vanity,
      social: val.social,
      links: val.links,
      branding: val.branding,
    };

    const hasAny =
      Boolean(typedData.location) ||
      Boolean(typedData.bio) ||
      Boolean(typedData.vanity) ||
      Boolean(typedData.social) ||
      Boolean(typedData.links) ||
      Boolean(typedData.branding);
    if (!hasAny) {
      ctx.addIssue({ code: 'custom', message: V.general.fieldRequired });
    }

    // A section that is present must be an object (null was mapped to absent above). Before, a
    // string `social` passed and reached the handler typed as an object.
    for (const [section, slot, message] of UPDATE_STYLIST_PROFILE_SECTIONS) {
      const value = typedData[section];
      if (value !== undefined && value !== null && !isPlainSection(value)) {
        ctx.addIssue({ code: 'custom', path: [slot], message });
      }
    }

    // ─── Location sub-section (when present) ─────────────────────────────────
    // A city is required only when a street is sent. Phone, website and the
    // business name save with an empty city; a street without a city does not.
    if (isPlainSection(typedData.location)) {
      const loc = typedData.location;
      const street =
        typeof loc.address_street === 'string' ? loc.address_street.trim() : '';
      const cityBlank =
        loc.address_city == null ||
        (typeof loc.address_city === 'string' &&
          loc.address_city.trim() === '');
      if (street.length > 0 && cityBlank) {
        ctx.addIssue({
          code: 'custom',
          path: ['location'],
          message: V.location.cityRequired,
        });
      } else if (
        loc.address_city != null &&
        typeof loc.address_city !== 'string'
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['location'],
          message: V.location.cityRequired,
        });
      } else if (typeof loc.address_city === 'string' && !cityBlank) {
        if (
          !validateByMinLength(loc.address_city, VALIDATION_LENGTHS.CITY_MIN)
        ) {
          ctx.addIssue({
            code: 'custom',
            path: ['location'],
            message: V.location.cityRequired,
          });
        }
        if (loc.address_city.length > VALIDATION_LENGTHS.CITY_MAX) {
          ctx.addIssue({
            code: 'custom',
            path: ['location'],
            message: V.location.cityTooLong,
          });
        }
      }

      if (
        !validateOptionalString(
          loc.business_name,
          VALIDATION_LENGTHS.BUSINESS_NAME_MAX
        )
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['location'],
          message: V.location.businessNameTooLong,
        });
      }
      if (
        !validateOptionalString(
          loc.address_street,
          VALIDATION_LENGTHS.STREET_MAX
        )
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['location'],
          message: V.location.streetTooLong,
        });
      }
      if (
        !validateOptionalString(
          loc.address_postal_code,
          VALIDATION_LENGTHS.POSTAL_CODE_MAX
        )
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['location'],
          message: V.location.postalCodeTooLong,
        });
      }
      // address_country had NO check at all: a non-string slipped through and reached
      // Prisma (`address_country || 'Poland'` keeps a truthy number/object) → 500.
      if (
        !validateOptionalString(
          loc.address_country,
          VALIDATION_LENGTHS.COUNTRY_MAX
        )
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['location'],
          message: V.location.countryInvalid,
        });
      }
      if (
        !validateOptionalString(loc.phone, VALIDATION_LENGTHS.PHONE_FIELD_MAX)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['location'],
          message: V.location.phoneTooLong,
        });
      } else if (
        typeof loc.phone === 'string' &&
        loc.phone.length > 0 &&
        !isValidPhoneNumber(loc.phone)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['location'],
          message: V.phone.invalidFormat,
        });
      }
      // XSS hardening (parity with admin-traits icon_url): scheme-allowlist via
      // validateOptionalHttpsUrl rejects javascript:/data:/vbscript:/file:/http:
      // at the validator boundary. The helper also enforces WEBSITE_MAX, so the
      // length check is subsumed.
      if (
        !validateOptionalHttpsUrl(loc.website, VALIDATION_LENGTHS.WEBSITE_MAX)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['location'],
          message: V.location.websiteInvalid,
        });
      }
      if (
        !validateOptionalString(
          loc.description,
          VALIDATION_LENGTHS.DESCRIPTION_MAX
        )
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['location'],
          message: V.location.descriptionTooLong,
        });
      }
    }

    // ─── Bio sub-section (when present): the public „O mnie” text alone ────
    if (isPlainSection(typedData.bio)) {
      const description = typedData.bio.description;
      if (
        description !== null &&
        (typeof description !== 'string' ||
          description.length > VALIDATION_LENGTHS.DESCRIPTION_MAX)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['description'],
          message: V.location.descriptionTooLong,
        });
      }
    }

    // ─── Vanity URL sub-section (when present) ───────────────────────────────
    if (isPlainSection(typedData.vanity)) {
      const vanity = typedData.vanity.vanity_url;
      if (vanity !== null) {
        if (typeof vanity !== 'string') {
          ctx.addIssue({
            code: 'custom',
            path: ['vanity_url'],
            message: V.vanityUrl.invalidType,
          });
        } else {
          const result = vanityUrlSchema.safeParse(vanity);
          if (!result.success) {
            ctx.addIssue({
              code: 'custom',
              path: ['vanity_url'],
              message:
                result.error.issues[0]?.message || V.vanityUrl.invalidFormat,
            });
          }
        }
      }
    }

    // ─── Social links sub-section (when present) ─────────────────────────────
    if (isPlainSection(typedData.social)) {
      const ig = typedData.social.instagram_handle;
      if (ig !== undefined && ig !== null) {
        if (typeof ig !== 'string') {
          ctx.addIssue({
            code: 'custom',
            path: ['instagram_handle'],
            message: V.social.instagramNotString,
          });
        } else if (ig.length > VALIDATION_SOCIAL.INSTAGRAM_HANDLE_MAX) {
          ctx.addIssue({
            code: 'custom',
            path: ['instagram_handle'],
            message: V.social.instagramTooLong,
          });
        } else if (
          ig.length > 0 &&
          !VALIDATION_REGEX.INSTAGRAM_HANDLE.test(ig)
        ) {
          ctx.addIssue({
            code: 'custom',
            path: ['instagram_handle'],
            message: V.social.instagramInvalidChars,
          });
        }
      }
    }
    // ─── External links (max 3, https only) ────────────────────────────────
    if (isPlainSection(typedData.links)) {
      const links = typedData.links.external_links;
      if (links !== undefined && links !== null) {
        if (!Array.isArray(links)) {
          ctx.addIssue({
            code: 'custom',
            path: ['external_links'],
            message: V.externalLinks.tooMany,
          });
        } else if (links.length > EXTERNAL_LINK_LIMIT) {
          ctx.addIssue({
            code: 'custom',
            path: ['external_links'],
            message: V.externalLinks.tooMany,
          });
        } else if (
          links.some(
            link => typeof link !== 'string' || !isValidExternalLink(link)
          )
        ) {
          ctx.addIssue({
            code: 'custom',
            path: ['external_links'],
            message: V.location.websiteInvalid,
          });
        }
      }
    }

    // ─── Branding sub-section (krok 1: kolor akcentu) ───────────────────────
    if (isPlainSection(typedData.branding)) {
      const color = typedData.branding.brand_accent_color;
      // null is an explicit reset to the default; a string must belong to the kernel's
      // curated palette (contrast is controlled in the data, not at runtime).
      if (
        color !== null &&
        (typeof color !== 'string' || !isBrandAccentHex(color))
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['brand_accent_color'],
          // Dedicated message (not fieldRequired): the field WAS provided, only
          // outside the curated palette. "pole wymagane" misled.
          message: V.branding.invalidColor,
        });
      }
    }
  });
