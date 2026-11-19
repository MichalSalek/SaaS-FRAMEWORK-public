/**
 * Characterization tests for pairingValidators: pins which field is rejected and __isValid,
 * not i18n text. Boundaries are derived from VALIDATION_LENGTHS.TOKEN_MIN/MAX.
 * Security: the session/pairing token (claim/revoke) and the target/stylist id presence and
 * string-type gates.
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

describe('pairingValidators.pairRequestCreate place and note', () => {
  const id = 'acc_test_0000000000000001';

  it('accepts a missing, null, blank or padded place and note', () => {
    for (const place of [undefined, null, '', '   ', '  Kraków  ']) {
      const result = V.pairRequestCreate({ stylist_account_id: id, place });
      expect(result.__isValid, JSON.stringify(place)).toBe(true);
    }
    const trimmed = V.pairRequestCreate({
      stylist_account_id: id,
      place: '  Kraków, Podgórze  ',
      note: '  czwartek  ',
    });
    expect(trimmed.__isValid).toBe(true);
    if (trimmed.__isValid) {
      expect(trimmed.__data.place).toBe('Kraków, Podgórze');
      expect(trimmed.__data.note).toBe('czwartek');
    }
    const blank = V.pairRequestCreate({
      stylist_account_id: id,
      place: '   ',
      note: '',
    });
    expect(blank.__isValid).toBe(true);
    if (blank.__isValid) {
      expect(blank.__data.place).toBeUndefined();
      expect(blank.__data.note).toBeUndefined();
    }
  });

  it('rejects a place over 60 characters and a note over 140', () => {
    const place = V.pairRequestCreate({
      stylist_account_id: id,
      place: 'a'.repeat(61),
    });
    expect(place.__isValid).toBe(false);
    expect(rejected(place, 'place')).toBe(true);
    const note = V.pairRequestCreate({
      stylist_account_id: id,
      note: 'a'.repeat(141),
    });
    expect(note.__isValid).toBe(false);
    expect(rejected(note, 'note')).toBe(true);
  });

  it('rejects control characters after trim', () => {
    const result = V.pairRequestCreate({
      stylist_account_id: id,
      place: 'Kraków\u0001',
      note: 'linia\n druga',
    });
    expect(result.__isValid).toBe(false);
    expect(rejected(result, 'place')).toBe(true);
    expect(rejected(result, 'note')).toBe(true);
  });

  it('accepts coordinates inside range and rejects the rest', () => {
    const ok = V.pairingResolvePlace({ latitude: 50.06, longitude: 19.94 });
    expect(ok.__isValid).toBe(true);
    const bad = V.pairingResolvePlace({ latitude: 91, longitude: 0 });
    expect(bad.__isValid).toBe(false);
    expect(rejected(bad, 'latitude')).toBe(true);
    const missing = V.pairingResolvePlace({});
    expect(missing.__isValid).toBe(false);
  });
});
