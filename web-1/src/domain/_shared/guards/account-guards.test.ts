/**
 * Golden-master tests for account-guards.ts (BDX W0.2 part B).
 *
 * Covers:
 *  - requireStylistAccount(currentUser)
 *    · success: currentUser with active stylist_account → OperationResult.success = StylistAccount
 *    · WRONG_ACCOUNT_TYPE: no stylist_account (client user)
 *    · ACCOUNT_INACTIVE: stylist_account present but not in activeAccountStates
 *    · EXPIRING is an active state (in activeAccountStates) → success
 *  - requireClientAccount(currentUser)
 *    · success: currentUser with client_account → OperationResult.success = ClientAccount
 *    · WRONG_ACCOUNT_TYPE: no client_account (stylist user)
 *    · Note: requireClientAccount does NOT check account status (guard has no inactive branch)
 *
 * Pure domain guard — no I/O, no mock plumbing required.
 */

import { describe, it, expect } from 'vitest';
import { requireStylistAccount, requireClientAccount } from './account-guards';
import {
  makeStylistCurrentUser,
  makeClientCurrentUser,
} from '../../../test-utils/fixtures';
import { AccountStatusValue } from '@kernel/models/db_models.generated.dto';

describe('requireStylistAccount', () => {
  // ── success path ─────────────────────────────────────────────────────────────

  it('returns success with StylistAccount when user has an active stylist_account (ACTIVE)', () => {
    const currentUser = makeStylistCurrentUser({
      account: { account_status: AccountStatusValue.ACTIVE },
    });
    const result = requireStylistAccount(currentUser);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.account_id).toBe(
        currentUser.stylist_account?.account_id
      );
    }
  });

  it('returns success when account_status is EXPIRING (activeAccountStates includes EXPIRING)', () => {
    // DECISION: EXPIRING is an active state (stylistka może nadal działać podczas wygasania).
    const currentUser = makeStylistCurrentUser({
      account: { account_status: AccountStatusValue.EXPIRING },
    });
    const result = requireStylistAccount(currentUser);
    expect(result.success).toBe(true);
  });

  // ── WRONG_ACCOUNT_TYPE ────────────────────────────────────────────────────────

  it('returns WRONG_ACCOUNT_TYPE error when currentUser has no stylist_account (client user)', () => {
    const currentUser = makeClientCurrentUser();
    // client users have stylist_account: null
    const result = requireStylistAccount(currentUser);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('UNAUTHORIZED');
      expect(result.error.reason).toBe('WRONG_ACCOUNT_TYPE');
    }
  });

  it('returns WRONG_ACCOUNT_TYPE when stylist_account explicitly null (override)', () => {
    // Build a stylist currentUser but override stylist_account to null to simulate
    // a structurally valid CurrentUser that lacks the account (edge case, e.g. soft-delete).
    const base = makeClientCurrentUser();
    const currentUser = { ...base, stylist_account: null };
    const result = requireStylistAccount(currentUser);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.reason).toBe('WRONG_ACCOUNT_TYPE');
    }
  });

  // ── ACCOUNT_INACTIVE ──────────────────────────────────────────────────────────

  it('returns ACCOUNT_INACTIVE when stylist_account status is NOT_ACTIVE', () => {
    const currentUser = makeStylistCurrentUser({
      account: { account_status: AccountStatusValue.NOT_ACTIVE },
    });
    const result = requireStylistAccount(currentUser);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('UNAUTHORIZED');
      expect(result.error.reason).toBe('ACCOUNT_INACTIVE');
    }
  });

  it('returns ACCOUNT_INACTIVE when stylist_account status is EXPIRED', () => {
    const currentUser = makeStylistCurrentUser({
      account: { account_status: AccountStatusValue.EXPIRED },
    });
    const result = requireStylistAccount(currentUser);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.reason).toBe('ACCOUNT_INACTIVE');
    }
  });

  // ── boundary: WRONG_ACCOUNT_TYPE is checked BEFORE ACCOUNT_INACTIVE ───────────

  it('account absence (null) returns WRONG_ACCOUNT_TYPE, not ACCOUNT_INACTIVE', () => {
    // Even if we imagine the account is "inactive", the guard checks presence first.
    const currentUser = makeClientCurrentUser();
    const result = requireStylistAccount(currentUser);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.reason).toBe('WRONG_ACCOUNT_TYPE');
    }
  });
});

describe('requireClientAccount', () => {
  // ── success path ─────────────────────────────────────────────────────────────

  it('returns success with ClientAccount when user has a client_account', () => {
    const currentUser = makeClientCurrentUser();
    const result = requireClientAccount(currentUser);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.client_account_id).toBe(
        currentUser.client_account?.client_account_id
      );
    }
  });

  // ── WRONG_ACCOUNT_TYPE ────────────────────────────────────────────────────────

  it('returns WRONG_ACCOUNT_TYPE error when currentUser has no client_account (stylist user)', () => {
    const currentUser = makeStylistCurrentUser();
    // stylist users have client_account: null
    const result = requireClientAccount(currentUser);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('UNAUTHORIZED');
      expect(result.error.reason).toBe('WRONG_ACCOUNT_TYPE');
    }
  });

  it('returns WRONG_ACCOUNT_TYPE when client_account explicitly null (override)', () => {
    const base = makeStylistCurrentUser();
    const currentUser = { ...base, client_account: null };
    const result = requireClientAccount(currentUser);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.reason).toBe('WRONG_ACCOUNT_TYPE');
    }
  });

  // ── no status check: requireClientAccount does NOT gate on account_status ─────

  // NEGATIVE / REGRESSION GUARD (intentional doc, not a failing test):
  // requireClientAccount only checks presence, NOT status. There is no
  // ACCOUNT_INACTIVE branch here (unlike requireStylistAccount). This is intentional:
  // clients are always-active platform users with no subscription concept.
  // If someone adds an `account_status` field to ClientAccount and mirrors the
  // stylist guard pattern, a new "status check" test should be added at that point.
  it('succeeds for any client_account regardless of other fields', () => {
    const currentUser = makeClientCurrentUser({
      account: { dashboard_note: 'some note' },
    });
    const result = requireClientAccount(currentUser);
    expect(result.success).toBe(true);
  });
});
