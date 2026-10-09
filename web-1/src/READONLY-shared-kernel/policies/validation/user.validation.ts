import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import { AccountTypeValue } from '../../models/db_models.generated.dto';
import type { USER_DTO_API_V1 } from '../../models/user/user.dto';
import {
  VALIDATION_LENGTHS,
  VALIDATION_REGEX,
  VALIDATION_SOCIAL,
} from '../validation.config';
import {
  validateEmail,
  validateByWhiteSpaces,
  validateByMinLength,
  validateByMaxLength,
  checkPhoneLength,
} from './validation.utils';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

const V = VALIDATION_MESSAGES;

// ── userChangeEmail ──
// Original: non-string email → V.email.invalid (single message). String email →
// run BOTH checks (each can add its own message, accumulated in order):
//   !validateEmail        → V.email.invalid
//   !validateByWhiteSpaces → V.email.noSpaces
// Reuse validateEmail / validateByWhiteSpaces (NOT z.email — different semantics:
// the project regex accepts +/#/dots, and validateEmail rejects falsy/non-string).
const userChangeEmailSchema = z.object({
  email: z
    .string({ error: V.email.invalid })
    .refine(v => validateEmail(v), V.email.invalid)
    .refine(v => validateByWhiteSpaces(v), V.email.noSpaces),
});

// ── userChangeName ──
// non-string → V.name.invalid. String → trim, then min/max (each can add):
//   !validateByMinLength(trimmed, NAME_MIN) → V.name.tooShort
//   !validateByMaxLength(trimmed, NAME_MAX) → V.name.tooLong
const userChangeNameSchema = z.object({
  name: z
    .string({ error: V.name.invalid })
    .refine(
      v => validateByMinLength(v.trim(), VALIDATION_LENGTHS.NAME_MIN),
      V.name.tooShort
    )
    .refine(
      v => validateByMaxLength(v.trim(), VALIDATION_LENGTHS.NAME_MAX),
      V.name.tooLong
    ),
});

// ── userOnboardAsStylist ──
// display_name / address_city: REQUEST DTO types them `string | null` (Pick<StylistAccount>),
//   but the original validator rejects any non-string (incl. null/undefined) — display_name
//   → V.name.invalid, address_city → V.address.cityRequired — then on a real string trims and
//   runs min/max. To BIND z.infer to the `string | null` DTO while preserving the
//   reject-null behavior, the field schema is `string | null` (.nullable()) with explicit
//   per-issue logic in a superRefine (a plain string base would infer `string`, breaking the
//   binding). See cross-field block below.
// phone (optional, string | null | undefined): original validates ONLY when the value
//   is truthy AND a string AND trimmed length > 0; then PHONE_ONBOARDING regex →
//   V.phone.invalidFormat. Falsy (incl. '' / null / undefined) or non-string → skipped
//   (no error). Modelled as .nullable().optional() + a refine that returns true for any
//   value failing the "truthy non-empty string" precondition.
// email_marketing (optional boolean): present-but-non-boolean → V.general.booleanRequired;
//   omitted → ok.
// ── userOnboardAsClient ──
// terms_accepted (optional boolean): the consent the backend records as
// User.terms_accepted_at; present-but-non-boolean → V.general.booleanRequired.
const userOnboardAsClientSchema = z.object({
  terms_accepted: z.boolean({ error: V.general.booleanRequired }).optional(),
});

const userOnboardAsStylistSchema = z.object({
  // DECISION (nie usuwaj tego komentarza):
  // display_name/address_city = `string | null` (.nullable()) bo DTO (Pick<StylistAccount>)
  // typuje je nullable, a binding wymaga z.infer == DTO. Base type-error niesie DOKŁADNY
  // klucz i18n oryginału (display_name → V.name.invalid, address_city → V.address.cityRequired)
  // dla wartości NIE-string-NIE-null (number/object/undefined — base parse rejectuje zanim
  // superRefine ruszy). null PRZECHODZI base (.nullable()), więc superRefine niżej emituje
  // ten sam klucz dla gałęzi `typeof !== 'string'`. Min/max walidowane w superRefine na
  // realnym stringu (po trim) — wierny port oryginału.
  // DECISION (nie usuwaj tego komentarza):
  // min/max walidowane w FIELD-LEVEL `.superRefine` (NIE object-level), by display_name i
  // address_city walidowały się NIEZALEŻNIE: non-string sibling (np. display_name=123) zawala
  // base-parse obiektu i zod POMINĄŁBY object-level superRefine → drugie pole gubiłoby
  // cityTooShort/cityTooLong (ręczny walidator sprawdzał każde pole osobno). Base type-error
  // (.nullable() → non-string-non-null) niesie dokładny klucz; null PRZECHODZI base, więc
  // superRefine emituje ten sam klucz dla gałęzi `typeof !== 'string'`.
  display_name: z
    .string({ error: V.name.invalid })
    .nullable()
    .superRefine((value, ctx) => {
      if (typeof value !== 'string') {
        ctx.addIssue({ code: 'custom', message: V.name.invalid });
        return;
      }
      const t = value.trim();
      if (!validateByMinLength(t, VALIDATION_LENGTHS.NAME_MIN)) {
        ctx.addIssue({ code: 'custom', message: V.name.tooShort });
      }
      if (!validateByMaxLength(t, VALIDATION_LENGTHS.NAME_MAX)) {
        ctx.addIssue({ code: 'custom', message: V.name.tooLong });
      }
    }),
  address_city: z
    .string({ error: V.address.cityRequired })
    .nullable()
    .superRefine((value, ctx) => {
      if (typeof value !== 'string') {
        ctx.addIssue({ code: 'custom', message: V.address.cityRequired });
        return;
      }
      const t = value.trim();
      if (!validateByMinLength(t, VALIDATION_LENGTHS.CITY_MIN)) {
        ctx.addIssue({ code: 'custom', message: V.address.cityTooShort });
      }
      if (!validateByMaxLength(t, VALIDATION_LENGTHS.CITY_MAX)) {
        ctx.addIssue({ code: 'custom', message: V.address.cityTooLong });
      }
    }),
  // DECISION (nie usuwaj tego komentarza):
  // phone używa z.custom<string>() (NIE z.string()) bo oryginał jest LAŹNIEJSZY niż DTO:
  // guard `typedData?.phone && typeof === 'string'` short-circuituje na non-stringu, więc
  // np. numeryczny phone jest CICHO POMIJANY (payload zostaje valid) — test charakteryzacyjny
  // to pinuje ("non-string truthy phone is skipped"). z.string() rejectowałby number type-errorem.
  // z.custom<string>() przepuszcza dowolny input na poziomie typu (akceptuje non-string =
  // zachowuje skip), a infer = `string | null | undefined` (.nullable().optional()) binduje do
  // DTO. Cała realna walidacja (regex PHONE_ONBOARDING na niepustym stringu) żyje w refine.
  phone: z
    .custom<string>()
    .nullable()
    .optional()
    .refine(v => {
      if (typeof v !== 'string') {
        return true;
      }
      const trimmed = v.trim();
      if (trimmed.length === 0) {
        return true;
      }
      // DECISION (nie usuwaj tego komentarza) — PODLOGA CYFR, NIE SAMYCH ZNAKOW:
      // PHONE_ONBOARDING to okno 9-20 ZNAKOW nad zbiorem [cyfry + - ( ) spacja], a komentarz
      // przy tej stalej obiecuje, ze jest „stricter than PHONE_FORMAT to block gibberish at
      // registration". Samo okno znakowe tego nie robilo: „(((((((((" i „+++++++++" (9 znakow,
      // ZERO cyfr) przechodzily jako numer telefonu, bo regex blokuje tylko litery. Dokladamy
      // wiec `checkPhoneLength` — ten sam SSOT, ktorego uzywa sciezka kontaktu klientki
      // (misc.validation) — zeby OBIE sciezki zgadzaly sie co do tego, co jest numerem:
      // 9-15 cyfr, sufit PHONE_FIELD_MAX na surowy ciag. Regex zostaje jako allowlist znakow.
      return (
        VALIDATION_REGEX.PHONE_ONBOARDING.test(trimmed) &&
        checkPhoneLength(trimmed) === null
      );
    }, V.phone.invalidFormat),
  email_marketing: z.boolean({ error: V.general.booleanRequired }).optional(),
  terms_accepted: z.boolean({ error: V.general.booleanRequired }).optional(),
  // Same rules and messages as the profile editor's social section
  // (account.validation): Instagram's own charset, max 30, empty = none. The
  // frontend strips „@” and a pasted profile URL before sending.
  instagram_handle: z
    .string({ error: V.social.instagramNotString })
    .nullable()
    .optional()
    .superRefine((value, ctx) => {
      if (typeof value !== 'string' || value.length === 0) {
        return;
      }
      if (value.length > VALIDATION_SOCIAL.INSTAGRAM_HANDLE_MAX) {
        ctx.addIssue({ code: 'custom', message: V.social.instagramTooLong });
      } else if (!VALIDATION_REGEX.INSTAGRAM_HANDLE.test(value)) {
        ctx.addIssue({
          code: 'custom',
          message: V.social.instagramInvalidChars,
        });
      }
    }),
});

// ── userSwitchRole ──
// Original returns { __isValid, account_type } (NO __general key) and validates via
// isValidAccountType (string ∈ ACCOUNT_ROLES). zod enum over AccountTypeValue infers
// the AccountType union (binds to DTO { account_type: AccountType }) and rejects any
// value not in the set (missing/non-string/wrong-string) with a single message —
// exactly matching isValidAccountType's single V.role.invalid branch.
const userSwitchRoleSchema = z.object({
  account_type: z.enum(AccountTypeValue, { error: V.role.invalid }),
});

// ── userCheckRecovery ──
// non-string → V.email.invalid. String but !validateEmail → V.email.invalid. (else-if,
// so at most ONE message — chain the single email refine; type-error reuses same key.)
const userCheckRecoverySchema = z.object({
  email: z
    .string({ error: V.email.invalid })
    .refine(v => validateEmail(v), V.email.invalid),
});

// ── userUpdateNotificationPreferences ──
// non-boolean → V.general.booleanRequired.
const userUpdateNotificationPreferencesSchema = z.object({
  notifications_enabled: z.boolean({ error: V.general.booleanRequired }),
});

export const userValidators = {
  userChangeEmail: (data: unknown) => zodValidate(userChangeEmailSchema, data),
  userChangeName: (data: unknown) => zodValidate(userChangeNameSchema, data),
  userOnboardAsStylist: (data: unknown) =>
    zodValidate(userOnboardAsStylistSchema, data),
  userOnboardAsClient: (data: unknown) =>
    zodValidate(userOnboardAsClientSchema, data),

  // Always-valid passthroughs (original returns { __isValid: true } with no field
  // checks — empty body, userId from session, or GET with no payload). No zod schema
  // and no binding witness: there is nothing to validate or to bind.
  deleteOrDisableSelfUser: (_data: unknown) => ({
    __isValid: true,
    __general: '',
  }),
  userGetAccountState: (_data: unknown) => ({ __isValid: true, __general: '' }),
  userGetUsageStats: (_data: unknown) => ({ __isValid: true, __general: '' }),
  userRestoreAccount: (_data: unknown) => ({ __isValid: true, __general: '' }),
  userReactivateAccount: (_data: unknown) => ({
    __isValid: true,
    __general: '',
  }),
  userGdprErase: (_data: unknown) => ({ __isValid: true, __general: '' }),

  userSwitchRole: (data: unknown) => zodValidate(userSwitchRoleSchema, data),
  userCheckRecovery: (data: unknown) =>
    zodValidate(userCheckRecoverySchema, data),
  userUpdateNotificationPreferences: (data: unknown) =>
    zodValidate(userUpdateNotificationPreferencesSchema, data),
} as const;

// ── Compile-time REQUEST-DTO ↔ schema binding (drift stops compilation) ──
// One property per non-passthrough validator. Passthrough validators (empty-body /
// GET / Record<string, never> REQUEST) are intentionally omitted — there is no field
// shape to bind. userSwitchRole binds against SWITCH_ROLE REQUEST ({ account_type }).
export type UserRequestSchemaBindings = {
  userChangeEmail: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof userChangeEmailSchema>,
      USER_DTO_API_V1['USER_REQUEST_EMAIL_CHANGE']['REQUEST']
    >
  >;
  userChangeName: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof userChangeNameSchema>,
      USER_DTO_API_V1['USER_CHANGE_NAME']['REQUEST']
    >
  >;
  userOnboardAsStylist: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof userOnboardAsStylistSchema>,
      USER_DTO_API_V1['USER_ONBOARD_AS_STYLIST']['REQUEST']
    >
  >;
  userOnboardAsClient: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof userOnboardAsClientSchema>,
      USER_DTO_API_V1['USER_ONBOARD_AS_CLIENT']['REQUEST']
    >
  >;
  userSwitchRole: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof userSwitchRoleSchema>,
      USER_DTO_API_V1['USER_SWITCH_ROLE']['REQUEST']
    >
  >;
  userCheckRecovery: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof userCheckRecoverySchema>,
      USER_DTO_API_V1['USER_CHECK_RECOVERY']['REQUEST']
    >
  >;
  userUpdateNotificationPreferences: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof userUpdateNotificationPreferencesSchema>,
      USER_DTO_API_V1['USER_UPDATE_NOTIFICATION_PREFERENCES']['REQUEST']
    >
  >;
};
