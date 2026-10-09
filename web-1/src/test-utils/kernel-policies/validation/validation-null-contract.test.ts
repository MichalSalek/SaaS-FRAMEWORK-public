/**
 * Null-contract lock (FWE Wave H FAZA 2, closing review).
 *
 * The zod migration aligns each optional field's null-handling to its REQUEST DTO:
 *  - DTO field typed `string | null` (nullable column) → validator ACCEPTS null (clear/no-op),
 *    matching the hand-written original. Implemented with `.nullable()`.
 *  - DTO field typed `string | undefined` (no null) → validator REJECTS null. This is a
 *    SANCTIONED tightening: `null` was loose-by-accident in the hand-written original
 *    (falsy-skip / validateOptionalString) and is not a contract value; rejecting it aligns
 *    runtime to the type (Wave H goal). Not reachable from the frontend (DTO forbids null).
 *
 * The characterization tests never feed `null` per-field, so this gate-visible test pins the
 * intended split and stops the closing-review finding from re-surfacing.
 */
import { describe, it, expect } from 'vitest';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';

const V = VALIDATION_POLICY.validators;

describe('null contract — null accepted iff the REQUEST DTO permits string | null', () => {
  it('clientUpdateContact ACCEPTS null (DTO contact_* = string | null → clear field)', () => {
    expect(V.clientUpdateContact({ contact_email: null }).__isValid).toBe(true);
    expect(V.clientUpdateContact({ contact_phone: null }).__isValid).toBe(true);
    expect(
      V.clientUpdateContact({ contact_email: null, contact_phone: null })
        .__isValid
    ).toBe(true);
    // present non-empty value still validated after the null branch
    expect(
      V.clientUpdateContact({ contact_email: 'not-an-email' }).__isValid
    ).toBe(false);
  });

  it('sessionContainerCreate REJECTS name:null (DTO name?: string, no null)', () => {
    expect(V.sessionContainerCreate({ name: null }).__isValid).toBe(false);
    // absent / undefined is still the valid "not provided" path
    expect(V.sessionContainerCreate({}).__isValid).toBe(true);
  });

  it('pairingRevokeAccess REJECTS target_account_id:null (DTO target_* = string | undefined)', () => {
    expect(
      V.pairingRevokeAccess({ target_user_id: 'u1', target_account_id: null })
        .__isValid
    ).toBe(false);
  });
});
