/**
 * Characterization tests for miscValidators (FWE Wave H, FAZA 1).
 *
 * These lock the CURRENT behavior of the kernel request validators in
 * `.shared-kernel/policies/validation/misc.validation.ts` as the safety net the zod
 * migration (FAZA 2) must preserve — every assertion below is GREEN against the
 * hand-written validators, so a zod rewrite that changes a field's accept/reject
 * decision (or which field carries the error) flips a test. They assert validation
 * LOGIC (which field is rejected, __isValid), NOT exact i18n message text (brittle):
 * a rejected field is asserted via a non-empty error string, accepted via an empty one.
 *
 * Valid/boundary inputs are DERIVED from SSOT configs (VALIDATION_LENGTHS,
 * VALID_CONTACT_TOPICS, STAFF_PERMISSIONS), not hardcoded, so a limit/allowlist change
 * in the config moves these in lockstep.
 *
 * SECURITY focus (must survive the zod rewrite):
 *  - salonStaffInvite: role allowlist is EXACTLY {'EMPLOYEE'} — OWNER/MANAGER rejected
 *    (over-grant of DEFAULT_PERMISSIONS_BY_ROLE.OWNER = all permissions).
 *  - salonStaffUpdate: ANY provided `role` is rejected (privilege-escalation gate);
 *    permissions must be an allowlisted-string array; empty body is rejected.
 *  - newsletterConfirm / newsletterUnsubscribe: token format/length gates.
 *  - email fields go through validateEmail + validateByWhiteSpaces (no-spaces gate).
 *
 * Sibling EXEMPLAR: gallery.validation.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';
import { VALID_CONTACT_TOPICS } from '@kernel/domain/support/contact-topics.config';
import { STAFF_PERMISSIONS } from '@kernel/domain/user-and-account/staff_accounts.config';

const V = VALIDATION_POLICY.validators;

// Helper: a field is "rejected" when its accumulated error string is non-empty.
const rejected = (r: Record<string, unknown>, field: string): boolean =>
  typeof r[field] === 'string' && (r[field] as string).trim().length > 0;

const SOME_TOPIC = VALID_CONTACT_TOPICS[0] as string;
const SOME_PERMISSION = STAFF_PERMISSIONS[0] as string;

// A plausibly-valid email/phone reused across cases.
const VALID_EMAIL = 'anna.kowalska@example.com';
const VALID_PHONE = '+48 600 700 800'; // 15 chars incl. formatting, all PHONE_FORMAT-legal

describe('miscValidators.clientUpdateContact', () => {
  it('accepts an empty payload (both fields optional)', () => {
    expect(V.clientUpdateContact({}).__isValid).toBe(true);
  });

  it('accepts a valid phone + valid email', () => {
    const r = V.clientUpdateContact({
      contact_phone: VALID_PHONE,
      contact_email: VALID_EMAIL,
    });
    expect(r.__isValid).toBe(true);
  });

  it('treats empty-string / whitespace-only phone & email as "cleared" (valid)', () => {
    expect(
      V.clientUpdateContact({ contact_phone: '', contact_email: '' }).__isValid
    ).toBe(true);
    // Whitespace-only trims to empty → field cleared, no validation error.
    expect(
      V.clientUpdateContact({ contact_phone: '   ', contact_email: '   ' })
        .__isValid
    ).toBe(true);
  });

  it('rejects a non-string phone (type guard → contact_phone error)', () => {
    const r = V.clientUpdateContact({
      contact_phone: 12345 as unknown as string,
    });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'contact_phone')).toBe(true);
  });

  it('rejects a phone shorter than PHONE_MIN and longer than PHONE_MAX', () => {
    const tooShort = '1'.repeat(VALIDATION_LENGTHS.PHONE_MIN - 1);
    const tooLong = '1'.repeat(VALIDATION_LENGTHS.PHONE_MAX + 1);
    expect(
      rejected(
        V.clientUpdateContact({ contact_phone: tooShort }),
        'contact_phone'
      )
    ).toBe(true);
    expect(
      rejected(
        V.clientUpdateContact({ contact_phone: tooLong }),
        'contact_phone'
      )
    ).toBe(true);
  });

  // REGRESJA (czerwony przed poprawka) — SCIEZKA ZYWA: zakres 9-15 liczony byl w
  // ZNAKACH, wiec normalnie zapisany numer z odstepami wracal jako blad z komunikatem
  // „Numer telefonu musi miec 9-15 cyfr", mimo ze cyfr ma 11. Pole na froncie nie ma
  // `maxLength`, wiec uzytkowniczka trafiala na to zwyklym wpisaniem numeru.
  it('accepts a normally formatted phone longer than PHONE_MAX in CHARACTERS', () => {
    const formatted = '+48 22 123 45 67';
    expect(formatted.length).toBeGreaterThan(VALIDATION_LENGTHS.PHONE_MAX);
    expect(V.clientUpdateContact({ contact_phone: formatted }).__isValid).toBe(
      true
    );
  });

  it('rejects a phone padded past PHONE_FIELD_MAX by format characters', () => {
    const padded = '+48 (22) 123 - 45 - 67';
    expect(padded.length).toBeGreaterThan(VALIDATION_LENGTHS.PHONE_FIELD_MAX);
    expect(
      rejected(
        V.clientUpdateContact({ contact_phone: padded }),
        'contact_phone'
      )
    ).toBe(true);
  });

  it('rejects a phone with illegal characters (PHONE_FORMAT regex)', () => {
    const r = V.clientUpdateContact({ contact_phone: '600abc700' });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'contact_phone')).toBe(true);
  });

  it('rejects a non-string email (type guard → contact_email error)', () => {
    const r = V.clientUpdateContact({
      contact_email: { x: 1 } as unknown as string,
    });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'contact_email')).toBe(true);
  });

  it('rejects a malformed email', () => {
    const r = V.clientUpdateContact({ contact_email: 'not-an-email' });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'contact_email')).toBe(true);
  });

  it('rejects an email longer than EMAIL_MAX', () => {
    const longLocal = 'a'.repeat(VALIDATION_LENGTHS.EMAIL_MAX) + '@example.com';
    const r = V.clientUpdateContact({ contact_email: longLocal });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'contact_email')).toBe(true);
  });
});

describe('miscValidators.salonStaffInvite', () => {
  it('accepts a valid email with role EMPLOYEE', () => {
    const r = V.salonStaffInvite({ email: VALID_EMAIL, role: 'EMPLOYEE' });
    expect(r.__isValid).toBe(true);
  });

  it('rejects a missing / non-string / malformed email', () => {
    expect(rejected(V.salonStaffInvite({ role: 'EMPLOYEE' }), 'email')).toBe(
      true
    );
    expect(
      rejected(
        V.salonStaffInvite({
          email: 42 as unknown as string,
          role: 'EMPLOYEE',
        }),
        'email'
      )
    ).toBe(true);
    expect(
      rejected(V.salonStaffInvite({ email: 'bad', role: 'EMPLOYEE' }), 'email')
    ).toBe(true);
  });

  it('SECURITY: role allowlist is EXACTLY {EMPLOYEE} — OWNER/MANAGER and anything else rejected', () => {
    for (const role of [
      'OWNER',
      'MANAGER',
      'ADMIN',
      'employee',
      '',
      undefined,
      null,
    ]) {
      const r = V.salonStaffInvite({ email: VALID_EMAIL, role });
      expect(r.__isValid, `role=${String(role)}`).toBe(false);
      expect(rejected(r, 'role'), `role=${String(role)}`).toBe(true);
    }
  });
});

describe('miscValidators.salonStaffUpdate', () => {
  it('accepts a permissions-only update with allowlisted permissions', () => {
    const r = V.salonStaffUpdate({ permissions: [SOME_PERMISSION] });
    expect(r.__isValid).toBe(true);
  });

  it('accepts an empty permissions array (no invalid member found)', () => {
    const r = V.salonStaffUpdate({ permissions: [] });
    expect(r.__isValid).toBe(true);
  });

  it('SECURITY: ANY provided role is rejected (privilege-escalation gate)', () => {
    for (const role of ['OWNER', 'MANAGER', 'EMPLOYEE', 'ANYTHING']) {
      const r = V.salonStaffUpdate({ role, permissions: [SOME_PERMISSION] });
      expect(r.__isValid, `role=${role}`).toBe(false);
      expect(rejected(r, 'role'), `role=${role}`).toBe(true);
    }
  });

  it('rejects non-array permissions and arrays with a non-allowlisted / non-string member', () => {
    expect(
      rejected(
        V.salonStaffUpdate({
          permissions: 'GALLERY_VIEW' as unknown as string[],
        }),
        'permissions'
      )
    ).toBe(true);
    expect(
      rejected(
        V.salonStaffUpdate({ permissions: ['NOT_A_PERMISSION'] }),
        'permissions'
      )
    ).toBe(true);
    expect(
      rejected(
        V.salonStaffUpdate({ permissions: [123 as unknown as string] }),
        'permissions'
      )
    ).toBe(true);
  });

  it('rejects an empty-body update (neither role nor permissions) via __general', () => {
    const r = V.salonStaffUpdate({});
    expect(r.__isValid).toBe(false);
    // empty body sets the general error, not a per-field one
    expect(rejected(r, '__general')).toBe(true);
  });
});

describe('miscValidators.newsletterSubscribe', () => {
  it('accepts a valid email with no consentSource', () => {
    expect(V.newsletterSubscribe({ email: VALID_EMAIL }).__isValid).toBe(true);
  });

  it('accepts a valid email with an in-range consentSource', () => {
    expect(
      V.newsletterSubscribe({
        email: VALID_EMAIL,
        consentSource: 'footer-form',
      }).__isValid
    ).toBe(true);
  });

  it('rejects a missing / malformed email', () => {
    expect(rejected(V.newsletterSubscribe({}), 'email')).toBe(true);
    expect(rejected(V.newsletterSubscribe({ email: 'nope' }), 'email')).toBe(
      true
    );
  });

  it('rejects an email containing whitespace (no-spaces gate)', () => {
    const r = V.newsletterSubscribe({ email: 'a b@example.com' });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'email')).toBe(true);
  });

  it('rejects a non-string consentSource and one over CONSENT_SOURCE_MAX', () => {
    expect(
      rejected(
        V.newsletterSubscribe({
          email: VALID_EMAIL,
          consentSource: 5 as unknown as string,
        }),
        'consentSource'
      )
    ).toBe(true);
    const tooLong = 'x'.repeat(VALIDATION_LENGTHS.CONSENT_SOURCE_MAX + 1);
    expect(
      rejected(
        V.newsletterSubscribe({ email: VALID_EMAIL, consentSource: tooLong }),
        'consentSource'
      )
    ).toBe(true);
  });
});

describe('miscValidators.newsletterConfirm', () => {
  const VALID_TOKEN = 'a'.repeat(32); // 32 lowercase-hex chars (min length, hex format)

  it('accepts a 32-char lowercase-hex token (boundary)', () => {
    expect(V.newsletterConfirm({ token: VALID_TOKEN }).__isValid).toBe(true);
  });

  it('accepts a 128-char hex token (upper boundary)', () => {
    expect(V.newsletterConfirm({ token: 'f'.repeat(128) }).__isValid).toBe(
      true
    );
  });

  it('rejects a missing / non-string / empty token', () => {
    expect(rejected(V.newsletterConfirm({}), 'token')).toBe(true);
    expect(
      rejected(
        V.newsletterConfirm({ token: 123 as unknown as string }),
        'token'
      )
    ).toBe(true);
    expect(rejected(V.newsletterConfirm({ token: '' }), 'token')).toBe(true);
  });

  it('rejects a token shorter than 32 or longer than 128 (hex chars)', () => {
    expect(
      rejected(V.newsletterConfirm({ token: 'a'.repeat(31) }), 'token')
    ).toBe(true);
    expect(
      rejected(V.newsletterConfirm({ token: 'a'.repeat(129) }), 'token')
    ).toBe(true);
  });

  it('rejects a 32+ char token with a non-hex character', () => {
    // 'z' is not in [a-f0-9] → format reject even at valid length
    expect(
      rejected(V.newsletterConfirm({ token: 'z'.repeat(40) }), 'token')
    ).toBe(true);
  });
});

describe('miscValidators.newsletterUnsubscribe', () => {
  it('accepts a 16-char token (lower boundary, no hex-format requirement)', () => {
    expect(V.newsletterUnsubscribe({ token: 'x'.repeat(16) }).__isValid).toBe(
      true
    );
  });

  it('accepts a 2048-char token (upper boundary)', () => {
    expect(V.newsletterUnsubscribe({ token: 'x'.repeat(2048) }).__isValid).toBe(
      true
    );
  });

  it('rejects a missing / non-string / empty token', () => {
    expect(rejected(V.newsletterUnsubscribe({}), 'token')).toBe(true);
    expect(
      rejected(
        V.newsletterUnsubscribe({ token: 0 as unknown as string }),
        'token'
      )
    ).toBe(true);
    expect(rejected(V.newsletterUnsubscribe({ token: '' }), 'token')).toBe(
      true
    );
  });

  it('rejects a token shorter than 16 or longer than 2048', () => {
    expect(
      rejected(V.newsletterUnsubscribe({ token: 'x'.repeat(15) }), 'token')
    ).toBe(true);
    expect(
      rejected(V.newsletterUnsubscribe({ token: 'x'.repeat(2049) }), 'token')
    ).toBe(true);
  });
});

describe('miscValidators.contactFormSubmit', () => {
  const valid = {
    name: 'Anna',
    topic: SOME_TOPIC,
    email: VALID_EMAIL,
    message: 'This is a real support message.',
  };

  it('accepts a well-formed contact submission', () => {
    expect(V.contactFormSubmit({ ...valid }).__isValid).toBe(true);
  });

  it('rejects a missing / non-string / whitespace-only name', () => {
    expect(rejected(V.contactFormSubmit({ ...valid, name: '' }), 'name')).toBe(
      true
    );
    expect(
      rejected(V.contactFormSubmit({ ...valid, name: '   ' }), 'name')
    ).toBe(true);
    expect(
      rejected(
        V.contactFormSubmit({ ...valid, name: 7 as unknown as string }),
        'name'
      )
    ).toBe(true);
  });

  it('rejects a name longer than CONTACT_NAME_MAX', () => {
    const longName = 'a'.repeat(VALIDATION_LENGTHS.CONTACT_NAME_MAX + 1);
    expect(
      rejected(V.contactFormSubmit({ ...valid, name: longName }), 'name')
    ).toBe(true);
  });

  it('rejects a missing topic and a topic not in VALID_CONTACT_TOPICS', () => {
    expect(
      rejected(V.contactFormSubmit({ ...valid, topic: '' }), 'topic')
    ).toBe(true);
    expect(
      rejected(V.contactFormSubmit({ ...valid, topic: 'not-a-topic' }), 'topic')
    ).toBe(true);
  });

  it('rejects a malformed email and an email with whitespace', () => {
    expect(
      rejected(V.contactFormSubmit({ ...valid, email: 'bad' }), 'email')
    ).toBe(true);
    expect(
      rejected(
        V.contactFormSubmit({ ...valid, email: 'a b@example.com' }),
        'email'
      )
    ).toBe(true);
  });

  it('rejects a missing / whitespace-only message', () => {
    expect(
      rejected(V.contactFormSubmit({ ...valid, message: '' }), 'message')
    ).toBe(true);
    expect(
      rejected(V.contactFormSubmit({ ...valid, message: '   ' }), 'message')
    ).toBe(true);
  });

  it('rejects a message longer than CONTACT_MESSAGE_MAX', () => {
    const longMsg = 'a'.repeat(VALIDATION_LENGTHS.CONTACT_MESSAGE_MAX + 1);
    expect(
      rejected(V.contactFormSubmit({ ...valid, message: longMsg }), 'message')
    ).toBe(true);
  });

  // turnstile_token: shape-only (presence is enforced at RUNTIME by the handler,
  // only when TURNSTILE_SECRET_KEY is configured — see contact-form handler).
  it('accepts a submission with a well-formed optional turnstile_token', () => {
    expect(
      V.contactFormSubmit({ ...valid, turnstile_token: 'XXXX.DUMMY.TOKEN' })
        .__isValid
    ).toBe(true);
  });

  it('rejects a non-string / oversized / NUL-carrying turnstile_token', () => {
    expect(
      rejected(
        V.contactFormSubmit({
          ...valid,
          turnstile_token: 7 as unknown as string,
        }),
        'turnstile_token'
      )
    ).toBe(true);
    expect(
      rejected(
        V.contactFormSubmit({
          ...valid,
          turnstile_token: 'x'.repeat(
            VALIDATION_LENGTHS.TURNSTILE_TOKEN_MAX + 1
          ),
        }),
        'turnstile_token'
      )
    ).toBe(true);
    expect(
      rejected(
        V.contactFormSubmit({ ...valid, turnstile_token: 'abc\u0000def' }),
        'turnstile_token'
      )
    ).toBe(true);
  });
});
