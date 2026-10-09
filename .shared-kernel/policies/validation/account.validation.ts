import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import { isBrandAccentHex } from '../../domain/user-and-account/branding.config';
import type { ACCOUNT_DTO_API_V1 } from '../../models/account/account.dto';
import { AccountTypeValue } from '../../models/db_models.generated.dto';
import {
  VALIDATION_LENGTHS,
  VALIDATION_GEO,
  VALIDATION_REGEX,
  VALIDATION_SOCIAL,
} from '../validation.config';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';
import {
  validateByMinLength,
  validateOptionalString,
  validateOptionalHttpsUrl,
  isValidNip,
  isCloudinaryAssetUrl,
} from './validation.utils';

const V = VALIDATION_MESSAGES;

// ── accountDisplayNameChange ───────────────────────────────────────────────
// Original: non-string → required; else validateByMinLength(>=3) → tooShort;
// validateByMaxLength(<=100) → tooLong. `.min`/`.max` reproduce the same accept/
// reject decisions ('' fails min → tooShort, like validateByMinLength on falsy).
const accountDisplayNameChangeSchema = z.object({
  display_name: z
    .string({ error: V.displayName.required })
    .min(VALIDATION_LENGTHS.DISPLAY_NAME_MIN, V.displayName.tooShort)
    .max(VALIDATION_LENGTHS.DISPLAY_NAME_MAX, V.displayName.tooLong),
});

// ── accountGetStylistsWithLocation ─────────────────────────────────────────
// Original: each field checked ONLY when !== undefined; non-number or out-of-range
// → single i18n key per field. Ranges are inclusive at the bounds (original uses
// `< MIN` / `> MAX`), radius rejects `<= 0` (→ `.gt(0)`) and `> MAX`.
const accountGetStylistsWithLocationSchema = z.object({
  latitude: z
    .number({ error: V.location.invalidLatitude })
    .min(VALIDATION_GEO.LATITUDE_MIN, V.location.invalidLatitude)
    .max(VALIDATION_GEO.LATITUDE_MAX, V.location.invalidLatitude)
    .optional(),
  longitude: z
    .number({ error: V.location.invalidLongitude })
    .min(VALIDATION_GEO.LONGITUDE_MIN, V.location.invalidLongitude)
    .max(VALIDATION_GEO.LONGITUDE_MAX, V.location.invalidLongitude)
    .optional(),
  radius_km: z
    .number({ error: V.location.invalidRadius })
    .gt(0, V.location.invalidRadius)
    .max(VALIDATION_GEO.RADIUS_KM_MAX, V.location.invalidRadius)
    .optional(),
});

// ── updateStylistProfile ───────────────────────────────────────────────────
// DECISION (nie usuwaj tego komentarza):
// Ten walidator jest WYJĄTKIEM od wzorca "schema.shape == REQUEST DTO". Oryginał
// (D5, run 25 TRD) konsumuje payload o kluczach REQUEST `{location, vanity, social}`,
// ale SPŁASZCZA błędy do PŁASKICH slotów error-DTO `{location, vanity_url,
// instagram_handle}` (= RESPONSE_ERROR shape). `zodValidate` wyprowadza sloty błędów
// z `schema.shape`, więc shape MUSI być error-DTO-keyed (`location`/`vanity_url`/
// `instagram_handle`), inaczej błędy vanity/social wpadłyby do `__general` i testy
// charakteryzacyjne (`rejected(r,'vanity_url')`, `rejected(r,'instagram_handle')`)
// by się wywaliły. Aby JEDNOCZEŚNIE czytać oryginalne klucze wejścia (`vanity`,
// `social`) używamy `z.looseObject` (passthrough) — nieznane klucze przeżywają do
// `superRefine`, gdzie odtwarzamy logikę 1:1. Dlatego NIE ma binding-witness dla tego
// walidatora (zob. komentarz przy GalleryRequestSchemaBindings poniżej): z.infer
// celowo NIE matchuje REQUEST (shape = error-DTO + loose-passthrough). To świadoma,
// jedyna w pliku rozbieżność wymuszona kontraktem error-DTO ≠ request-DTO.
const updateStylistProfileSchema = z
  .looseObject({
    location: z.unknown().optional(),
    vanity_url: z.unknown().optional(),
    instagram_handle: z.unknown().optional(),
    brand_accent_color: z.unknown().optional(),
  })
  .superRefine((val, ctx) => {
    const typedData = val as Partial<
      ACCOUNT_DTO_API_V1['UPDATE_STYLIST_PROFILE']['REQUEST']
    >;

    const hasAny =
      Boolean(typedData.location) ||
      Boolean(typedData.vanity) ||
      Boolean(typedData.social) ||
      Boolean(typedData.branding);
    if (!hasAny) {
      ctx.addIssue({ code: 'custom', message: V.general.fieldRequired });
    }

    // ─── Location sub-section (when present) ─────────────────────────────────
    if (typedData.location) {
      const loc = typedData.location;

      if (typeof loc.address_city !== 'string') {
        ctx.addIssue({
          code: 'custom',
          path: ['location'],
          message: V.location.cityRequired,
        });
      } else {
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

    // ─── Vanity URL sub-section (when present) ───────────────────────────────
    if (typedData.vanity) {
      const vanity = typedData.vanity.vanity_url;
      if (vanity !== null) {
        if (typeof vanity !== 'string') {
          ctx.addIssue({
            code: 'custom',
            path: ['vanity_url'],
            message: V.vanityUrl.invalidType,
          });
        } else if (
          vanity.length < VALIDATION_LENGTHS.VANITY_URL_MIN ||
          vanity.length > VALIDATION_LENGTHS.VANITY_URL_MAX
        ) {
          ctx.addIssue({
            code: 'custom',
            path: ['vanity_url'],
            message: V.vanityUrl.invalidLength,
          });
        } else if (!VALIDATION_REGEX.VANITY_URL_FORMAT.test(vanity)) {
          ctx.addIssue({
            code: 'custom',
            path: ['vanity_url'],
            message: V.vanityUrl.invalidFormat,
          });
        }
      }
    }

    // ─── Social links sub-section (when present) ─────────────────────────────
    if (typedData.social) {
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
    // ─── Branding sub-section (krok 1: kolor akcentu) ───────────────────────
    if (typedData.branding) {
      const color = typedData.branding.brand_accent_color;
      // null = jawny reset do domyślnego; string MUSI należeć do kuratorowanej
      // palety kernela (kontrola kontrastu w danych, nie w runtime).
      if (
        color !== null &&
        (typeof color !== 'string' || !isBrandAccentHex(color))
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['brand_accent_color'],
          // Dedykowany komunikat (nie fieldRequired): pole BYŁO podane, tylko
          // spoza kuratorowanej palety — „pole wymagane" mylił (review S51).
          message: V.branding.invalidColor,
        });
      }
    }
  });

// ── accountSetAvatar ───────────────────────────────────────────────────────
// Zdjęcie profilowe stylistki. `null` = jawne wyczyszczenie kolumny (powrót do
// fallbacku OAuth/inicjałów) i dlatego `.nullable()`, a NIE `.optional()`:
// klucz jest w kontrakcie zawsze, brak klucza to błąd kształtu, nie „nie zmieniaj".
// Adres musi wskazywać na nasz CDN — przeglądarka wgrywa plik do CDN-u obrazów,
// a API zapisuje tylko adres, więc bez tej bramki dowolny POST wstawiłby na
// publiczny profil obcy obrazek (albo
// `javascript:`) renderowany potem w `<img>` i w OG/JSON-LD.
const accountSetAvatarSchema = z.object({
  avatar_url: z
    .string({ error: V.account.avatarUrlInvalid })
    .min(1, V.account.avatarUrlInvalid)
    .max(VALIDATION_LENGTHS.ASSET_URL_MAX, V.account.avatarUrlInvalid)
    .refine(isCloudinaryAssetUrl, V.account.avatarUrlInvalid)
    .nullable(),
});

// ── accountIncrementView ───────────────────────────────────────────────────
// Original: `!id || typeof !== 'string'` → invalidId (rejects '' and non-string).
const accountIncrementViewSchema = z.object({
  stylist_account_id: z
    .string({ error: V.account.invalidId })
    .min(1, V.account.invalidId),
});

// ── accountSetDashboardNote ────────────────────────────────────────────────
// note: original accepts `null` or `string` (≤ MAX); undefined/non-string →
// fieldRequired (NOT optional — `note` is a required DTO key), over-long string →
// tooLong. `.nullable()` (not `.optional()`) reproduces this: null OK, undefined →
// type error fieldRequired.
// account_type: `!type || !values.includes(type)` → invalidAccountType (rejects
// '', undefined, null, and any non-AccountTypeValue). z.enum does exactly that.
const accountSetDashboardNoteSchema = z.object({
  note: z
    .string({ error: V.general.fieldRequired })
    .max(VALIDATION_LENGTHS.DASHBOARD_NOTE_MAX, V.dashboardNote.tooLong)
    .nullable(),
  account_type: z.enum(AccountTypeValue, {
    error: V.dashboardNote.invalidAccountType,
  }),
});

// ── vatInvoiceDetails (Faktura VAT) ────────────────────────────────────────
// Dane firmowe kupującego (subform opcjonalny, ale gdy wysłany — WSZYSTKIE pola
// wymagane). NIP przez kernel checksum (isValidNip: normalizacja + modulo 11 waga
// [6,5,7,2,3,4,5,6,7]). Kod pocztowy PL NN-NNN. Miasto reuse CITY_MIN/MAX.
//
// DECISION (nie usuwaj tego komentarza):
// `.trim()` MUSI stać PRZED `.min()` na polach tekstowych (companyName,
// addressLine1, addressCity). Bez tego `'   '` przechodziło `.min(2)` po surowej
// długości i tożsamość do faktury VAT zapisywała się z pustą nazwą firmy / pustym
// adresem, ale poprawnym NIP-em — faktura bez danych nabywcy, przy której kupujący
// nie odliczy VAT. Frontend trimował, backend nie: klasyczny client/server drift,
// omijalny surowym POST-em. Kolejność jest wiążąca (zod odpala checki w kolejności
// dopisania) — `.min().trim()` waliduje przed obcięciem i wraca do starej dziury.
// Kod pocztowy i NIP nie potrzebują trimu: regex PL NN-NNN nie przepuszcza białych
// znaków, a isValidNip normalizuje wejście przed sumą kontrolną.
const vatInvoiceDetailsSchema = z.object({
  companyName: z
    .string({ error: V.vatInvoice.companyNameRequired })
    .trim()
    .min(
      VALIDATION_LENGTHS.VAT_COMPANY_NAME_MIN,
      V.vatInvoice.companyNameRequired
    )
    .max(
      VALIDATION_LENGTHS.VAT_COMPANY_NAME_MAX,
      V.vatInvoice.companyNameTooLong
    ),
  nip: z
    .string({ error: V.vatInvoice.nipInvalid })
    .refine(value => isValidNip(value), V.vatInvoice.nipInvalid),
  addressLine1: z
    .string({ error: V.vatInvoice.addressLineRequired })
    .trim()
    .min(
      VALIDATION_LENGTHS.VAT_ADDRESS_LINE_MIN,
      V.vatInvoice.addressLineRequired
    )
    .max(
      VALIDATION_LENGTHS.VAT_ADDRESS_LINE_MAX,
      V.vatInvoice.addressLineTooLong
    ),
  addressCity: z
    .string({ error: V.vatInvoice.cityRequired })
    .trim()
    .min(VALIDATION_LENGTHS.CITY_MIN, V.vatInvoice.cityRequired)
    .max(VALIDATION_LENGTHS.CITY_MAX, V.vatInvoice.cityTooLong),
  addressPostalCode: z
    .string({ error: V.vatInvoice.postalCodeInvalid })
    .regex(VALIDATION_REGEX.POSTAL_CODE_PL, V.vatInvoice.postalCodeInvalid),
});

export const accountValidators = {
  accountDisplayNameChange: (data: unknown) =>
    zodValidate(accountDisplayNameChangeSchema, data),
  accountGetStylistsWithLocation: (data: unknown) =>
    zodValidate(accountGetStylistsWithLocationSchema, data),
  updateStylistProfile: (data: unknown) =>
    zodValidate(updateStylistProfileSchema, data),
  accountSetAvatar: (data: unknown) =>
    zodValidate(accountSetAvatarSchema, data),
  accountIncrementView: (data: unknown) =>
    zodValidate(accountIncrementViewSchema, data),
  accountSetDashboardNote: (data: unknown) =>
    zodValidate(accountSetDashboardNoteSchema, data),
  vatInvoiceDetails: (data: unknown) =>
    zodValidate(vatInvoiceDetailsSchema, data),
} as const;

// ── Compile-time REQUEST-DTO ↔ schema binding (drift stops compilation) ──
// One exported witness type per domain; each property fails to compile if the schema's
// inferred output drifts from its REQUEST DTO. Exported so it is never flagged unused.
//
// DECISION (nie usuwaj tego komentarza):
// Dwa walidatory są ŚWIADOMIE poza witnessem:
//  1. accountDisplayNameChange — REQUEST DTO to `display_name: string | null`, ale
//     oryginał (i testy charakteryzacyjne, `null → rejected`) ODRZUCA null
//     (`typeof !== 'string' → required`). Wierny schemat = `z.string()` (infer
//     `string`), więc NIE matchuje `string | null` DTO. Tu runtime jest STRICTER niż
//     kontrakt; nie mogę poluzować schematu (złamałbym test) ani edytować DTO (inny
//     plik). Drift udokumentowany — DTO nad-permisywne wobec null.
//  2. updateStylistProfile — schema.shape jest error-DTO-keyed + loose-passthrough
//     (patrz DECISION przy updateStylistProfileSchema), więc z.infer celowo ≠ REQUEST.
export type AccountRequestSchemaBindings = {
  accountGetStylistsWithLocation: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof accountGetStylistsWithLocationSchema>,
      ACCOUNT_DTO_API_V1['ACCOUNT_GET_STYLISTS_WITH_LOCATION']['REQUEST']
    >
  >;
  accountSetAvatar: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof accountSetAvatarSchema>,
      ACCOUNT_DTO_API_V1['ACCOUNT_SET_AVATAR']['REQUEST']
    >
  >;
  accountIncrementView: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof accountIncrementViewSchema>,
      ACCOUNT_DTO_API_V1['ACCOUNT_INCREMENT_VIEW']['REQUEST']
    >
  >;
  accountSetDashboardNote: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof accountSetDashboardNoteSchema>,
      ACCOUNT_DTO_API_V1['ACCOUNT_SET_DASHBOARD_NOTE']['REQUEST']
    >
  >;
  vatInvoiceDetails: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof vatInvoiceDetailsSchema>,
      ACCOUNT_DTO_API_V1['ACCOUNT_VAT_INVOICE_DETAILS']['REQUEST']
    >
  >;
};
