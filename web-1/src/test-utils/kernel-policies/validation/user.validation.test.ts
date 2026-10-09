/**
 * Characterization tests for userValidators (FWE Wave H, FAZA 1).
 *
 * These lock the CURRENT behavior of the kernel user request-validators as the safety
 * net the zod migration (FAZA 2) must preserve — every assertion below is GREEN against
 * the hand-written validators, so a zod rewrite that changes a field's accept/reject
 * decision (or which field carries the error) flips a test. They assert the validation
 * LOGIC (which field is rejected, __isValid), NOT exact i18n message text (brittle) — a
 * rejected field is asserted via a non-empty error string, an accepted field via __isValid.
 *
 * Valid/boundary inputs are DERIVED from the SSOT configs (VALIDATION_LENGTHS, ACCOUNT_ROLES),
 * not hardcoded, so a limit change in the config moves these in lockstep.
 *
 * SECURITY focus (must survive the zod rewrite): email validators reject non-strings,
 * malformed shapes, and any whitespace; name/city length floors and ceilings hold; the
 * role switch only accepts members of the SSOT role set; boolean-flag fields reject
 * non-booleans. These are the accept/reject decisions an attacker probes.
 *
 * Sibling of gallery.validation.test.ts — same shape.
 */
import { describe, it, expect } from 'vitest';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';
import { ACCOUNT_ROLES } from '@kernel/domain/user-and-account/role_switch.config';

const V = VALIDATION_POLICY.validators;

// Helper: a field is "rejected" when its accumulated error string is non-empty.
const rejected = (r: Record<string, unknown>, field: string): boolean =>
  typeof r[field] === 'string' && (r[field] as string).trim().length > 0;

// A well-formed email per VALIDATION_REGEX.EMAIL (alnum + . _ - # local part, dotted host).
const VALID_EMAIL = 'anna.kowalska@example.com';

describe('userValidators.userChangeEmail', () => {
  it('accepts a well-formed email', () => {
    const r = V.userChangeEmail({ email: VALID_EMAIL });
    expect(r.__isValid).toBe(true);
    expect(rejected(r, 'email')).toBe(false);
  });

  it('SECURITY: rejects a non-string email (array/object/number/null/undefined) on the email field', () => {
    for (const bad of [
      123 as unknown as string,
      {} as unknown as string,
      [] as unknown as string,
      null as unknown as string,
      undefined as unknown as string,
      true as unknown as string,
    ]) {
      const r = V.userChangeEmail({ email: bad });
      expect(r.__isValid, `email=${String(bad)}`).toBe(false);
      expect(rejected(r, 'email'), `email=${String(bad)}`).toBe(true);
    }
  });

  it('SECURITY: rejects malformed email shapes', () => {
    for (const bad of ['', 'plainstring', 'no@tld', '@example.com', 'a@b']) {
      const r = V.userChangeEmail({ email: bad });
      expect(r.__isValid, `email=${bad}`).toBe(false);
      expect(rejected(r, 'email'), `email=${bad}`).toBe(true);
    }
  });

  it('SECURITY: rejects an email containing whitespace', () => {
    for (const bad of [
      'a b@example.com',
      ' anna@example.com',
      'anna@example.com ',
      'anna@exa mple.com',
      'anna@example.com\n',
      'anna@example.com\t',
    ]) {
      const r = V.userChangeEmail({ email: bad });
      expect(r.__isValid, `email=${JSON.stringify(bad)}`).toBe(false);
      expect(rejected(r, 'email'), `email=${JSON.stringify(bad)}`).toBe(true);
    }
  });

  it('rejects a missing email object (no email key)', () => {
    const r = V.userChangeEmail({});
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'email')).toBe(true);
  });
});

describe('userValidators.userChangeName', () => {
  const minName = 'x'.repeat(VALIDATION_LENGTHS.NAME_MIN);
  const maxName = 'x'.repeat(VALIDATION_LENGTHS.NAME_MAX);

  it('accepts a name at the min and max boundary', () => {
    expect(V.userChangeName({ name: minName }).__isValid).toBe(true);
    expect(V.userChangeName({ name: maxName }).__isValid).toBe(true);
  });

  it('SECURITY: rejects a non-string name on the name field', () => {
    for (const bad of [
      123 as unknown as string,
      {} as unknown as string,
      null as unknown as string,
      undefined as unknown as string,
    ]) {
      const r = V.userChangeName({ name: bad });
      expect(r.__isValid, `name=${String(bad)}`).toBe(false);
      expect(rejected(r, 'name'), `name=${String(bad)}`).toBe(true);
    }
  });

  it('rejects a name shorter than NAME_MIN (after trim)', () => {
    const tooShort = 'x'.repeat(VALIDATION_LENGTHS.NAME_MIN - 1);
    const r = V.userChangeName({ name: tooShort });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'name')).toBe(true);
  });

  it('rejects a name longer than NAME_MAX (after trim)', () => {
    const tooLong = 'x'.repeat(VALIDATION_LENGTHS.NAME_MAX + 1);
    const r = V.userChangeName({ name: tooLong });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'name')).toBe(true);
  });

  it('SURPRISE: name is TRIMMED before length check — whitespace-only trims to empty → too short', () => {
    const r = V.userChangeName({ name: '    ' });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'name')).toBe(true);
  });

  it('SURPRISE: surrounding whitespace does NOT count toward length (trim) — a min-length core padded by spaces is valid', () => {
    const r = V.userChangeName({ name: `  ${minName}  ` });
    expect(r.__isValid).toBe(true);
  });
});

describe('userValidators.userOnboardAsStylist', () => {
  const valid = {
    display_name: 'x'.repeat(VALIDATION_LENGTHS.NAME_MIN),
    address_city: 'x'.repeat(VALIDATION_LENGTHS.CITY_MIN),
  };

  it('accepts a minimal valid payload (name + city, optional fields omitted)', () => {
    const r = V.userOnboardAsStylist({ ...valid });
    expect(r.__isValid).toBe(true);
  });

  it('rejects a non-string / too-short / too-long display_name', () => {
    expect(
      rejected(
        V.userOnboardAsStylist({
          ...valid,
          display_name: 123 as unknown as string,
        }),
        'display_name'
      )
    ).toBe(true);
    expect(
      rejected(
        V.userOnboardAsStylist({
          ...valid,
          display_name: 'x'.repeat(VALIDATION_LENGTHS.NAME_MIN - 1),
        }),
        'display_name'
      )
    ).toBe(true);
    expect(
      rejected(
        V.userOnboardAsStylist({
          ...valid,
          display_name: 'x'.repeat(VALIDATION_LENGTHS.NAME_MAX + 1),
        }),
        'display_name'
      )
    ).toBe(true);
  });

  it('rejects a non-string / too-short / too-long address_city', () => {
    expect(
      rejected(
        V.userOnboardAsStylist({
          ...valid,
          address_city: 123 as unknown as string,
        }),
        'address_city'
      )
    ).toBe(true);
    expect(
      rejected(
        V.userOnboardAsStylist({
          ...valid,
          address_city: 'x'.repeat(VALIDATION_LENGTHS.CITY_MIN - 1),
        }),
        'address_city'
      )
    ).toBe(true);
    expect(
      rejected(
        V.userOnboardAsStylist({
          ...valid,
          address_city: 'x'.repeat(VALIDATION_LENGTHS.CITY_MAX + 1),
        }),
        'address_city'
      )
    ).toBe(true);
  });

  it('PARTIAL: phone is optional — omitted, empty, or whitespace-only is accepted', () => {
    expect(V.userOnboardAsStylist({ ...valid }).__isValid).toBe(true);
    expect(V.userOnboardAsStylist({ ...valid, phone: '' }).__isValid).toBe(
      true
    );
    expect(V.userOnboardAsStylist({ ...valid, phone: '   ' }).__isValid).toBe(
      true
    );
  });

  it('accepts a well-formed phone and rejects a malformed one', () => {
    expect(
      V.userOnboardAsStylist({ ...valid, phone: '+48 600 700 800' }).__isValid
    ).toBe(true);
    const r = V.userOnboardAsStylist({ ...valid, phone: 'not-a-phone!!!' });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'phone')).toBe(true);
  });

  // REGRESJA (czerwony przed poprawka): PHONE_ONBOARDING to okno 9-20 ZNAKOW, wiec ciag
  // zlozony wylacznie ze znakow formatujacych przechodzil jako numer telefonu — mimo ze
  // komentarz przy tej stalej obiecuje blokowanie gibberishu na rejestracji.
  it('rejects a phone made only of format characters (zero digits)', () => {
    expect(
      rejected(
        V.userOnboardAsStylist({ ...valid, phone: '(((((((((' }),
        'phone'
      )
    ).toBe(true);
    expect(
      rejected(
        V.userOnboardAsStylist({ ...valid, phone: '+++++++++' }),
        'phone'
      )
    ).toBe(true);
  });

  it('SURPRISE: a non-string truthy phone is skipped (guard requires typeof string) — payload stays valid', () => {
    // `typedData?.phone && typeof typedData.phone === 'string'` short-circuits on a number,
    // so a numeric phone never reaches the regex and the field is not rejected.
    expect(
      V.userOnboardAsStylist({
        ...valid,
        phone: 123456789 as unknown as string,
      }).__isValid
    ).toBe(true);
  });

  it('email_marketing: omitted or a real boolean is accepted; a present non-boolean is rejected', () => {
    expect(V.userOnboardAsStylist({ ...valid }).__isValid).toBe(true);
    expect(
      V.userOnboardAsStylist({ ...valid, email_marketing: true }).__isValid
    ).toBe(true);
    expect(
      V.userOnboardAsStylist({ ...valid, email_marketing: false }).__isValid
    ).toBe(true);
    const r = V.userOnboardAsStylist({
      ...valid,
      email_marketing: 'yes' as unknown as boolean,
    });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'email_marketing')).toBe(true);
  });
});

describe('userValidators.userSwitchRole', () => {
  it('accepts a member of the SSOT role set', () => {
    for (const role of ACCOUNT_ROLES) {
      expect(
        V.userSwitchRole({ account_type: role }).__isValid,
        `role=${role}`
      ).toBe(true);
    }
  });

  it('SECURITY: rejects an unknown / non-string / missing account_type', () => {
    for (const bad of [
      'ADMIN',
      'stylist',
      '',
      123 as unknown as string,
      null as unknown as string,
      undefined as unknown as string,
      {} as unknown as string,
    ]) {
      const r = V.userSwitchRole({ account_type: bad });
      expect(r.__isValid, `account_type=${String(bad)}`).toBe(false);
      expect(rejected(r, 'account_type'), `account_type=${String(bad)}`).toBe(
        true
      );
    }
  });
});

describe('userValidators.userCheckRecovery', () => {
  it('accepts a well-formed email', () => {
    expect(V.userCheckRecovery({ email: VALID_EMAIL }).__isValid).toBe(true);
  });

  it('SECURITY: rejects a non-string or malformed email on the email field', () => {
    for (const bad of [
      '',
      'plainstring',
      '@x.com',
      123 as unknown as string,
      null as unknown as string,
    ]) {
      const r = V.userCheckRecovery({ email: bad });
      expect(r.__isValid, `email=${String(bad)}`).toBe(false);
      expect(rejected(r, 'email'), `email=${String(bad)}`).toBe(true);
    }
  });

  it('SURPRISE: userCheckRecovery does NOT run a whitespace check (unlike userChangeEmail) — but the email regex still rejects spaces', () => {
    // userCheckRecovery only calls validateEmail (no validateByWhiteSpaces branch), yet
    // VALIDATION_REGEX.EMAIL has no \s in its char classes, so an email with a space is
    // still rejected by validateEmail alone.
    const r = V.userCheckRecovery({ email: 'an na@example.com' });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'email')).toBe(true);
  });
});

describe('userValidators.userUpdateNotificationPreferences', () => {
  it('accepts a boolean notifications_enabled (true and false)', () => {
    expect(
      V.userUpdateNotificationPreferences({ notifications_enabled: true })
        .__isValid
    ).toBe(true);
    expect(
      V.userUpdateNotificationPreferences({ notifications_enabled: false })
        .__isValid
    ).toBe(true);
  });

  it('SECURITY: rejects a non-boolean / missing notifications_enabled', () => {
    for (const bad of ['true', 1, 0, null, undefined, {}]) {
      const r = V.userUpdateNotificationPreferences({
        notifications_enabled: bad as unknown as boolean,
      });
      expect(r.__isValid, `value=${String(bad)}`).toBe(false);
      expect(rejected(r, 'notifications_enabled'), `value=${String(bad)}`).toBe(
        true
      );
    }
  });
});

describe('userValidators — always-valid (no-payload / session-only) endpoints', () => {
  // These validators carry no field checks (userId comes from the session, body is empty),
  // so ANY input — including garbage — is accepted. Locking this prevents a zod rewrite from
  // silently introducing a body schema where there was deliberately none.
  const noPayloadValidators = [
    'deleteOrDisableSelfUser',
    'userOnboardAsClient',
    'userGetAccountState',
    'userGetUsageStats',
    'userRestoreAccount',
    'userReactivateAccount',
    'userGdprErase',
  ] as const;

  for (const name of noPayloadValidators) {
    it(`${name}: accepts empty, populated, and garbage payloads`, () => {
      const fn = V[name] as (d: unknown) => { __isValid: boolean };
      expect(fn({}).__isValid, `${name}({})`).toBe(true);
      expect(fn({ anything: 'x', n: 1 }).__isValid, `${name}(populated)`).toBe(
        true
      );
      expect(fn(null).__isValid, `${name}(null)`).toBe(true);
      expect(fn(undefined).__isValid, `${name}(undefined)`).toBe(true);
      expect(fn('garbage' as unknown).__isValid, `${name}(string)`).toBe(true);
    });
  }
});
