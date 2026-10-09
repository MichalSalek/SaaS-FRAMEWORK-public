/**
 * Characterization tests for pairingValidators (FWE Wave H, FAZA 1).
 *
 * These lock the CURRENT behavior of the kernel pairing request validators as the safety
 * net the zod migration (FAZA 2) must preserve — every assertion below is GREEN against the
 * hand-written validators, so a zod rewrite that changes a field's accept/reject decision
 * (or which field carries the error) flips a test. They assert the validation LOGIC
 * (which field is rejected, __isValid), NOT exact i18n message text (brittle) — a rejected
 * field is asserted via a non-empty error string, an accepted field via an empty one.
 *
 * Valid/boundary inputs are DERIVED from the SSOT config (VALIDATION_LENGTHS.TOKEN_MIN/MAX),
 * not hardcoded, so a token-length change in the config moves these in lockstep.
 *
 * SECURITY focus: the session/pairing token (claim/revoke) and the target/stylist id
 * presence + string-type gates — these MUST survive the zod migration unchanged.
 *
 * Sibling of gallery.validation.test.ts (the FAZA 1 exemplar).
 */
import { describe, it, expect } from 'vitest';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';

const V = VALIDATION_POLICY.validators;

// Helper: a field is "rejected" when its accumulated error string is non-empty.
const rejected = (r: Record<string, unknown>, field: string): boolean =>
  typeof r[field] === 'string' && (r[field] as string).trim().length > 0;

// A token of exactly TOKEN_MIN chars (boundary-valid). TOKEN_MIN..TOKEN_MAX accepted.
const MIN_TOKEN = 'a'.repeat(VALIDATION_LENGTHS.TOKEN_MIN);
const MAX_TOKEN = 'a'.repeat(VALIDATION_LENGTHS.TOKEN_MAX);

describe('pairingValidators.pairingClaimSession', () => {
  it('accepts a token at the configured min length', () => {
    const r = V.pairingClaimSession({ token: MIN_TOKEN });
    expect(r.__isValid).toBe(true);
    expect(rejected(r, 'token')).toBe(false);
  });

  it('accepts a token at the configured max length', () => {
    const r = V.pairingClaimSession({ token: MAX_TOKEN });
    expect(r.__isValid).toBe(true);
  });

  it('SECURITY: rejects a missing / empty / whitespace-only token', () => {
    for (const bad of [undefined, null, '', '   ']) {
      const r = V.pairingClaimSession({ token: bad as unknown as string });
      expect(r.__isValid, `token=${JSON.stringify(bad)}`).toBe(false);
      expect(rejected(r, 'token'), `token=${JSON.stringify(bad)}`).toBe(true);
    }
  });

  it('SECURITY: rejects a non-string token (number / object / array / boolean)', () => {
    for (const bad of [123, {}, [], true]) {
      const r = V.pairingClaimSession({ token: bad as unknown as string });
      expect(r.__isValid, `token=${JSON.stringify(bad)}`).toBe(false);
      expect(rejected(r, 'token'), `token=${JSON.stringify(bad)}`).toBe(true);
    }
  });

  it('SECURITY: rejects a token shorter than TOKEN_MIN after trim', () => {
    const tooShort = 'a'.repeat(VALIDATION_LENGTHS.TOKEN_MIN - 1);
    const r = V.pairingClaimSession({ token: tooShort });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'token')).toBe(true);
  });

  it('SECURITY: rejects a token longer than TOKEN_MAX after trim', () => {
    const tooLong = 'a'.repeat(VALIDATION_LENGTHS.TOKEN_MAX + 1);
    const r = V.pairingClaimSession({ token: tooLong });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'token')).toBe(true);
  });

  it('CHARACTERIZATION: length is measured AFTER trim — surrounding whitespace is stripped first', () => {
    // A min-length token padded with whitespace still passes (trimmed length == TOKEN_MIN).
    const padded = `   ${MIN_TOKEN}   `;
    expect(V.pairingClaimSession({ token: padded }).__isValid).toBe(true);
    // Whitespace-padded content shorter than TOKEN_MIN fails (trim drops the padding).
    const paddedShort = `   ${'a'.repeat(VALIDATION_LENGTHS.TOKEN_MIN - 1)}   `;
    expect(V.pairingClaimSession({ token: paddedShort }).__isValid).toBe(false);
  });

  it('CHARACTERIZATION: a null payload rejects (token treated as missing)', () => {
    const r = V.pairingClaimSession(null);
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'token')).toBe(true);
  });
});

describe('pairingValidators.pairingRevokeSession', () => {
  it('accepts any non-empty string token (NO length check, unlike claim)', () => {
    // CHARACTERIZATION: revoke only checks presence + string type, not TOKEN_MIN/MAX.
    expect(V.pairingRevokeSession({ token: MIN_TOKEN }).__isValid).toBe(true);
    expect(V.pairingRevokeSession({ token: 'x' }).__isValid).toBe(true); // 1 char OK
    expect(
      V.pairingRevokeSession({
        token: 'a'.repeat(VALIDATION_LENGTHS.TOKEN_MAX + 50),
      }).__isValid
    ).toBe(true); // over TOKEN_MAX still OK
  });

  it('SECURITY: rejects a missing / empty token', () => {
    for (const bad of [undefined, null, '']) {
      const r = V.pairingRevokeSession({ token: bad as unknown as string });
      expect(r.__isValid, `token=${JSON.stringify(bad)}`).toBe(false);
      expect(rejected(r, 'token'), `token=${JSON.stringify(bad)}`).toBe(true);
    }
  });

  it('SECURITY: rejects a non-string token', () => {
    for (const bad of [123, {}, [], true]) {
      const r = V.pairingRevokeSession({ token: bad as unknown as string });
      expect(r.__isValid, `token=${JSON.stringify(bad)}`).toBe(false);
      expect(rejected(r, 'token'), `token=${JSON.stringify(bad)}`).toBe(true);
    }
  });

  it('CHARACTERIZATION: a null payload rejects (token treated as missing)', () => {
    expect(V.pairingRevokeSession(null).__isValid).toBe(false);
  });
});

describe('pairingValidators.pairingRevokeAccess', () => {
  it('accepts when target_user_id is provided as a string', () => {
    const r = V.pairingRevokeAccess({ target_user_id: 'user-1' });
    expect(r.__isValid).toBe(true);
  });

  it('accepts when target_account_id is provided as a string', () => {
    const r = V.pairingRevokeAccess({ target_account_id: 'acc-1' });
    expect(r.__isValid).toBe(true);
  });

  it('accepts when BOTH targets are provided as strings', () => {
    const r = V.pairingRevokeAccess({
      target_user_id: 'user-1',
      target_account_id: 'acc-1',
    });
    expect(r.__isValid).toBe(true);
  });

  it('SECURITY: rejects when NEITHER target is provided (error on __general, not a named field)', () => {
    const r = V.pairingRevokeAccess({});
    expect(r.__isValid).toBe(false);
    // CHARACTERIZATION: the "one target required" error accumulates on __general.
    expect(rejected(r, '__general')).toBe(true);
    expect(rejected(r, 'target_user_id')).toBe(false);
    expect(rejected(r, 'target_account_id')).toBe(false);
  });

  it('CHARACTERIZATION: empty-string targets count as ABSENT → __general "target required"', () => {
    // Both '' are falsy → !user && !account is true → targetRequired on __general.
    const r = V.pairingRevokeAccess({
      target_user_id: '',
      target_account_id: '',
    });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, '__general')).toBe(true);
  });

  it('CHARACTERIZATION: a non-string target_user_id is rejected on its own field', () => {
    // Truthy non-string trips the type check → invalidUserId on target_user_id.
    const r = V.pairingRevokeAccess({
      target_user_id: 123 as unknown as string,
    });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'target_user_id')).toBe(true);
    // The presence guard passed (target_user_id is truthy), so __general stays clean.
    expect(rejected(r, '__general')).toBe(false);
  });

  it('CHARACTERIZATION: a non-string target_account_id is rejected on its own field', () => {
    const r = V.pairingRevokeAccess({
      target_account_id: { id: 1 } as unknown as string,
    });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'target_account_id')).toBe(true);
    expect(rejected(r, '__general')).toBe(false);
  });

  it('CHARACTERIZATION: a null payload rejects via __general (both targets absent)', () => {
    const r = V.pairingRevokeAccess(null);
    expect(r.__isValid).toBe(false);
    expect(rejected(r, '__general')).toBe(true);
  });
});

describe('pairingValidators.pairingGetAccessStatus', () => {
  it('accepts a string stylist_account_id', () => {
    const r = V.pairingGetAccessStatus({ stylist_account_id: 'sa-1' });
    expect(r.__isValid).toBe(true);
    expect(rejected(r, 'stylist_account_id')).toBe(false);
  });

  it('SECURITY: rejects a missing / empty stylist_account_id', () => {
    for (const bad of [undefined, null, '']) {
      const r = V.pairingGetAccessStatus({
        stylist_account_id: bad as unknown as string,
      });
      expect(r.__isValid, `id=${JSON.stringify(bad)}`).toBe(false);
      expect(
        rejected(r, 'stylist_account_id'),
        `id=${JSON.stringify(bad)}`
      ).toBe(true);
    }
  });

  it('SECURITY: rejects a non-string stylist_account_id', () => {
    for (const bad of [123, {}, [], true]) {
      const r = V.pairingGetAccessStatus({
        stylist_account_id: bad as unknown as string,
      });
      expect(r.__isValid, `id=${JSON.stringify(bad)}`).toBe(false);
      expect(
        rejected(r, 'stylist_account_id'),
        `id=${JSON.stringify(bad)}`
      ).toBe(true);
    }
  });

  it('CHARACTERIZATION: a null payload rejects (id treated as missing)', () => {
    expect(V.pairingGetAccessStatus(null).__isValid).toBe(false);
  });
});
