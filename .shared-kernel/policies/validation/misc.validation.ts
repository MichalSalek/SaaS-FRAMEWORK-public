import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import { VALID_CONTACT_TOPICS } from '../../domain/support/contact-topics.config';
import {
  STAFF_INVITATION_RESPONSES,
  STAFF_PERMISSIONS,
} from '../../domain/user-and-account/staff_accounts.config';
import type { CLIENT_DTO_API_V1 } from '../../models/client/client.dto';
import type { NEWSLETTER_DTO_API_V1 } from '../../models/newsletter/newsletter.dto';
import type { PUBLIC_DTO_API_V1 } from '../../models/public/public.dto';
import type { SALON_STAFF_DTO_API_V1 } from '../../models/salon-staff/salon-staff.dto';
import { VALIDATION_LENGTHS, VALIDATION_REGEX } from '../validation.config';
import {
  validateEmail,
  validateByWhiteSpaces,
  checkPhoneLength,
} from './validation.utils';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

const V = VALIDATION_MESSAGES;

// Token format regex for newsletterConfirm (lowercase/uppercase hex). Mirrors the
// original inline `/^[a-f0-9]+$/i` — kept inline (single call-site, not in VALIDATION_REGEX).
const HEX_TOKEN = /^[a-f0-9]+$/i;

// ── clientUpdateContact ──────────────────────────────────────────────────────
// Both fields optional; an empty / whitespace-only value is "cleared" (valid, stored
// as null). A present non-empty value is validated AFTER trim. Phone accumulates
// tooShort + invalidChars independently; email accumulates tooLong + invalid.
// `z.string(...)` base catches a non-string (→ phone.invalidChars / email.invalid,
// the original type-guard branch) and aborts the refine, so non-strings yield exactly
// one message like the hand-written validator.
//
// DECISION (nie usuwaj tego komentarza):
// `.nullable()` jest CELOWE: REQUEST DTO = Partial<Pick<ClientAccount, contact_*>> a
// kolumny ClientAccount są `string | null`, więc `null` jest LEGALNĄ wartością kontraktu
// (= „wyczyść pole", zapisywane jako null) — tak jak akceptował ręczny walidator HEAD
// (guard `x !== null`). `.optional()` łapie tylko `undefined`, więc bez `.nullable()`
// `null` byłby błędnie odrzucany (regresja fidelity). `z.infer` = `string | null | undefined`
// matchuje DTO → binding-witness odzyskany (patrz MiscRequestSchemaBindings).
const clientUpdateContactSchema = z.object({
  contact_phone: z
    .string({ error: V.phone.invalidChars })
    .nullable()
    .optional()
    .superRefine((value, ctx) => {
      if (value === undefined || value === null || value === '') {
        return;
      }
      const phone = value.trim();
      if (phone.length === 0) {
        return;
      } // whitespace-only → cleared
      // Zakres liczony w CYFRACH + sufit na surowy ciąg — SSOT checkPhoneLength
      // (DECISION w validation.utils.ts). Osobny komunikat dla za długiego numeru.
      const lengthIssue = checkPhoneLength(phone);
      if (lengthIssue === 'tooShort') {
        ctx.addIssue({ code: 'custom', message: V.phone.tooShort });
      } else if (lengthIssue === 'tooLong') {
        ctx.addIssue({ code: 'custom', message: V.phone.tooLong });
      }
      if (!VALIDATION_REGEX.PHONE_FORMAT.test(phone)) {
        ctx.addIssue({ code: 'custom', message: V.phone.invalidChars });
      }
    }),
  contact_email: z
    .string({ error: V.email.invalid })
    .nullable()
    .optional()
    .superRefine((value, ctx) => {
      if (value === undefined || value === null || value === '') {
        return;
      }
      const email = value.trim();
      if (email.length === 0) {
        return;
      } // whitespace-only → cleared
      if (email.length > VALIDATION_LENGTHS.EMAIL_MAX) {
        ctx.addIssue({ code: 'custom', message: V.email.tooLong });
      }
      if (!validateEmail(email)) {
        ctx.addIssue({ code: 'custom', message: V.email.invalid });
      }
    }),
});

// ── salonStaffInvite ─────────────────────────────────────────────────────────
// SECURITY (DECISION preserved from the hand-written validator below): role allowlist
// is EXACTLY {'EMPLOYEE'}.
//
// DECISION (nie usuwaj tego komentarza):
// Invite accepts ONLY the EMPLOYEE role server-side — even though StaffRole has
// OWNER/MANAGER/EMPLOYEE. OWNER is NEVER invitable: a salon has exactly one owner
// (its creator, StylistAccount.created_by_user_id), so a second OWNER is spurious
// and would grant DEFAULT_PERMISSIONS_BY_ROLE.OWNER = all permissions. MANAGER is
// withheld until the UI actually offers a role picker (today the UI only ever sends
// EMPLOYEE). Accepting an arbitrary isValidStaffRole here let a crafted POST
// self-grant elevated default permissions (over-grant). Gate at the validator so
// every caller of salonStaffInvite is constrained; widen this allowlist the day the
// UI supports choosing MANAGER. `z.literal('EMPLOYEE')` is that exact gate (every
// other value — incl. OWNER/MANAGER/''/null/undefined — fails → role.staffRoleRequired).
const salonStaffInviteSchema = z.object({
  email: z
    .string({ error: V.email.invalid })
    .refine(value => validateEmail(value), V.email.invalid),
  role: z.literal('EMPLOYEE', { error: V.role.staffRoleRequired }),
});

// ── salonStaffRespondInvitation ──────────────────────────────────────────────
// The invitee answers her own invitation: the StaffMember id (ownership is proven
// in the operation by user_id = session user, never by anything in the body) and
// a closed ACCEPT/DECLINE enum, so an unknown answer never reaches the operation.
const salonStaffRespondInvitationSchema = z.object({
  staff_member_id: z
    .string({ error: V.general.fieldRequired })
    .min(1, V.general.fieldRequired)
    // Upper bound for an identifier: see WHY at ENTITY_ID_MAX.
    .max(VALIDATION_LENGTHS.ENTITY_ID_MAX, V.general.fieldRequired),
  response: z.enum(STAFF_INVITATION_RESPONSES, {
    error: V.general.fieldRequired,
  }),
});

// ── salonStaffUpdate ─────────────────────────────────────────────────────────
// DECISION (nie usuwaj tego komentarza):
// Parallel to the salonStaffInvite floor: the update path REJECTS any `role` field
// entirely. The UI only ever sends `permissions` (SalonStaffPage.tsx
// updatePermissions.mutate sends `{ permissions }`, there is no role picker).
// Accepting an arbitrary isValidStaffRole here (OWNER/MANAGER/EMPLOYEE) let a crafted
// PATCH `{ role: 'OWNER', permissions: [...] }` escalate an EMPLOYEE to OWNER scoped
// to the caller's own salon — and the frontend gates the remove action on !isOwner, so
// the escalated card became un-removable. A salon has exactly one OWNER (its creator,
// StylistAccount.created_by_user_id); reassigning role via this endpoint is never a
// legitimate operation today. Reject role at the validator so every caller of
// salonStaffUpdate is constrained; widen the day the UI ships a real role picker (and
// add a server-side ceiling then).
//
// role/permissions are typed `unknown` (no REQUEST DTO — this is an inline-cast
// validator) so all logic lives in a single object-level superRefine: per-field issues
// route to their slot via `path`, the empty-body rule routes to `__general` via an
// empty path. `zodValidate` still derives the `role`/`permissions` error slots from
// `schema.shape` (preserved across superRefine in zod v4).
const salonStaffUpdateSchema = z
  .object({
    role: z.unknown().optional(),
    permissions: z.unknown().optional(),
  })
  .superRefine((data, ctx) => {
    const { role, permissions } = data;

    // ANY provided role is rejected (privilege-escalation gate).
    if (role !== undefined && role !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['role'],
        message: V.role.staffRoleRequired,
      });
    }

    if (permissions !== undefined && permissions !== null) {
      if (!Array.isArray(permissions)) {
        ctx.addIssue({
          code: 'custom',
          path: ['permissions'],
          message: V.role.permissionsRequired,
        });
      } else {
        const invalidPermission = permissions.find(p => {
          if (typeof p !== 'string') {
            return true;
          }
          return !STAFF_PERMISSIONS.includes(
            p as (typeof STAFF_PERMISSIONS)[number]
          );
        });

        if (invalidPermission !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['permissions'],
            message: V.role.permissionsRequired,
          });
        }
      }
    }

    // DD2-M8 r28: reject empty-body PATCH — both role + permissions optional means an
    // empty body would otherwise validate as { __isValid: true } → no-op DB call +
    // misleading audit event. If neither field is present, require at least one
    // (general error, empty path → __general slot).
    if (
      (role === undefined || role === null) &&
      (permissions === undefined || permissions === null)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: V.general.fieldRequired,
      });
    }
  });

// ── newsletterSubscribe ──────────────────────────────────────────────────────
// email accumulates invalid + noSpaces (both checks run, like the original). The
// `z.string(...)` base binds `email` to the REQUEST DTO `string`; a non-string surfaces
// email.invalid (the dominant original key) and aborts the refine.
const newsletterSubscribeSchema = z.object({
  email: z.string({ error: V.email.invalid }).superRefine((value, ctx) => {
    if (!validateEmail(value)) {
      ctx.addIssue({ code: 'custom', message: V.email.invalid });
    }
    if (!validateByWhiteSpaces(value)) {
      ctx.addIssue({ code: 'custom', message: V.email.noSpaces });
    }
  }),
  consentSource: z
    .string({ error: V.consentSource.notString })
    .max(VALIDATION_LENGTHS.CONSENT_SOURCE_MAX, V.consentSource.tooLong)
    .optional(),
});

// ── newsletterConfirm ────────────────────────────────────────────────────────
// token: non-string/empty → token.required; else non-hex OR <32 OR >128 →
// token.invalidFormat (mutually exclusive if/else, replicated in the superRefine).
const newsletterConfirmSchema = z.object({
  token: z.string({ error: V.token.required }).superRefine((value, ctx) => {
    if (value.length === 0) {
      ctx.addIssue({ code: 'custom', message: V.token.required });
      return;
    }
    if (!HEX_TOKEN.test(value) || value.length < 32 || value.length > 128) {
      ctx.addIssue({ code: 'custom', message: V.token.invalidFormat });
    }
  }),
});

// ── newsletterUnsubscribe ────────────────────────────────────────────────────
// token: non-string/empty → token.required; else <16 OR >2048 → token.invalidFormat.
// No hex-format requirement (URL-embedded unsubscribe tokens are wider than confirm).
const newsletterUnsubscribeSchema = z.object({
  token: z.string({ error: V.token.required }).superRefine((value, ctx) => {
    if (value.length === 0) {
      ctx.addIssue({ code: 'custom', message: V.token.required });
      return;
    }
    if (value.length < 16 || value.length > 2048) {
      ctx.addIssue({ code: 'custom', message: V.token.invalidFormat });
    }
  }),
});

// ── contactFormSubmit ────────────────────────────────────────────────────────
// name/message: required (non-string OR trim-empty) XOR tooLong (if/else). topic:
// missing/empty/non-string → topicRequired, non-empty non-allowlisted → topicInvalid
// (enum error fn, like gallery nail_length). email: invalid + noSpaces accumulate.
const contactFormSubmitSchema = z.object({
  name: z
    .string({ error: V.contact.nameRequired })
    .superRefine((value, ctx) => {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        ctx.addIssue({ code: 'custom', message: V.contact.nameRequired });
      } else if (trimmed.length > VALIDATION_LENGTHS.CONTACT_NAME_MAX) {
        ctx.addIssue({ code: 'custom', message: V.contact.nameTooLong });
      }
    }),
  topic: z.enum(VALID_CONTACT_TOPICS, {
    error: issue =>
      typeof issue.input === 'string' && issue.input.length > 0
        ? V.contact.topicInvalid
        : V.contact.topicRequired,
  }),
  email: z.string({ error: V.email.invalid }).superRefine((value, ctx) => {
    if (!validateEmail(value)) {
      ctx.addIssue({ code: 'custom', message: V.email.invalid });
    }
    if (!validateByWhiteSpaces(value)) {
      ctx.addIssue({ code: 'custom', message: V.email.noSpaces });
    }
  }),
  message: z
    .string({ error: V.contact.messageRequired })
    .superRefine((value, ctx) => {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        ctx.addIssue({ code: 'custom', message: V.contact.messageRequired });
      } else if (trimmed.length > VALIDATION_LENGTHS.CONTACT_MESSAGE_MAX) {
        ctx.addIssue({ code: 'custom', message: V.contact.messageTooLong });
      }
    }),
  // Cloudflare Turnstile response token — OPTIONAL in the schema (presence is a
  // RUNTIME requirement, enforced by the handler only when TURNSTILE_SECRET_KEY is
  // configured; see contact-form handler). Shape-only here: non-string →
  // token.invalidFormat, > vendor cap (2048) → token.tooLong, embedded NUL byte →
  // token.invalidFormat (defense-in-depth — the middleware null-byte guard is the
  // primary gate, but this validator must stay safe for any future non-middleware
  // caller). Whether the token VERIFIES is Cloudflare's call, never zod's.
  turnstile_token: z
    .string({ error: V.token.invalidFormat })
    .max(VALIDATION_LENGTHS.TURNSTILE_TOKEN_MAX, V.token.tooLong)
    .refine(value => !value.includes('\u0000'), V.token.invalidFormat)
    .optional(),
});

export const miscValidators = {
  clientUpdateContact: (data: unknown) =>
    zodValidate(clientUpdateContactSchema, data),
  salonStaffInvite: (data: unknown) =>
    zodValidate(salonStaffInviteSchema, data),
  salonStaffUpdate: (data: unknown) =>
    zodValidate(salonStaffUpdateSchema, data),
  salonStaffRespondInvitation: (data: unknown) =>
    zodValidate(salonStaffRespondInvitationSchema, data),
  newsletterSubscribe: (data: unknown) =>
    zodValidate(newsletterSubscribeSchema, data),
  newsletterConfirm: (data: unknown) =>
    zodValidate(newsletterConfirmSchema, data),
  newsletterUnsubscribe: (data: unknown) =>
    zodValidate(newsletterUnsubscribeSchema, data),
  contactFormSubmit: (data: unknown) =>
    zodValidate(contactFormSubmitSchema, data),
} as const;

// ── Compile-time REQUEST-DTO ↔ schema binding (drift stops compilation) ──
// One witness property per validator that has a named REQUEST DTO. Only
// salonStaffInvite/salonStaffUpdate are intentionally omitted: they type role/permissions
// as the security gate (`z.literal('EMPLOYEE')` / reject-any-role) which is deliberately
// STRICTER than the DTO's `unknown`/`StaffRole` shape, so a witness would either fail or
// lie (per zasada 8/9). clientUpdateContact IS bound (its REQUEST DTO =
// Partial<Pick<ClientAccount, contact_*>>, nullable — see the `.nullable()` DECISION above).
export type MiscRequestSchemaBindings = {
  salonStaffRespondInvitation: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof salonStaffRespondInvitationSchema>,
      SALON_STAFF_DTO_API_V1['SALON_STAFF_RESPOND_INVITATION']['REQUEST']
    >
  >;
  clientUpdateContact: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof clientUpdateContactSchema>,
      CLIENT_DTO_API_V1['CLIENT_UPDATE_CONTACT']['REQUEST']
    >
  >;
  newsletterSubscribe: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof newsletterSubscribeSchema>,
      NEWSLETTER_DTO_API_V1['NEWSLETTER_SUBSCRIBE']['REQUEST']
    >
  >;
  newsletterConfirm: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof newsletterConfirmSchema>,
      NEWSLETTER_DTO_API_V1['NEWSLETTER_CONFIRM']['REQUEST']
    >
  >;
  newsletterUnsubscribe: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof newsletterUnsubscribeSchema>,
      NEWSLETTER_DTO_API_V1['NEWSLETTER_UNSUBSCRIBE']['REQUEST']
    >
  >;
  contactFormSubmit: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof contactFormSubmitSchema>,
      PUBLIC_DTO_API_V1['CONTACT_FORM_SUBMIT']['REQUEST']
    >
  >;
};
