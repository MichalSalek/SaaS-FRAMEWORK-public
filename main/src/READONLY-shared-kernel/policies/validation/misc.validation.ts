import { z } from 'zod';
import { clientUpdateContactSchema } from '../../domain/client/client.contract-schemas';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import { VALID_CONTACT_TOPICS } from '../../domain/support/contact-topics.config';
import type { CLIENT_DTO_API_V1 } from '../../models/client/client.dto';
import type { NEWSLETTER_DTO_API_V1 } from '../../models/newsletter/newsletter.dto';
import type { PUBLIC_DTO_API_V1 } from '../../models/public/public.dto';
import type { SALON_STAFF_DTO_API_V1 } from '../../models/salon-staff/salon-staff.dto';

import {
  salonStaffAcceptTokenSchema,
  salonStaffInviteSchema,
  salonStaffLeaveTeamSchema,
  salonStaffRespondInvitationSchema,
  salonStaffUpdateSchema,
} from '../../domain/salon-staff/salon-staff.contract-schemas';

import { VALIDATION_LENGTHS } from '../validation.config';
import { validateByWhiteSpaces, validateEmail } from './validation.utils';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

const V = VALIDATION_MESSAGES;

// Token format regex for newsletterConfirm (lowercase/uppercase hex). Mirrors the
// original inline `/^[a-f0-9]+$/i` — kept inline (single call-site, not in VALIDATION_REGEX).
const HEX_TOKEN = /^[a-f0-9]+$/i;

// ── newsletterSubscribe ──────────────────────────────────────────────────────
// email accumulates invalid + noSpaces (both checks run, like the original). The
// `z.string(...)` base binds `email` to the REQUEST DTO `string`; a non-string surfaces
// email.invalid (the dominant original key) and aborts the refine.
const turnstileTokenSchema = z
  .string({ error: V.token.invalidFormat })
  .max(VALIDATION_LENGTHS.TURNSTILE_TOKEN_MAX, V.token.tooLong)
  .refine(value => !value.includes('\u0000'), V.token.invalidFormat)
  .optional();

export const newsletterSubscribeSchema = z.object({
  turnstile_token: turnstileTokenSchema,
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
export const contactFormSubmitSchema = z.object({
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
  turnstile_token: turnstileTokenSchema,
});

export const miscValidators = {
  clientUpdateContact: (data: unknown) =>
    zodValidate(clientUpdateContactSchema, data),
  salonStaffInvite: (data: unknown) =>
    zodValidate(salonStaffInviteSchema, data),
  salonStaffUpdate: (data: unknown) =>
    zodValidate(salonStaffUpdateSchema, data),
  salonStaffAcceptToken: (data: unknown) =>
    zodValidate(salonStaffAcceptTokenSchema, data),
  salonStaffLeaveTeam: (data: unknown) =>
    zodValidate(salonStaffLeaveTeamSchema, data),
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
