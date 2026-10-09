/**
 * Unit test — isAccountActive (account.config.ts) SINGLE-state activeness predicate.
 *
 * WHAT THIS PROTECTS
 * ──────────────────
 * `isAccountActive` is the JS companion to STYLIST_PUBLICLY_VISIBLE's `account_status`
 * clause: the PUBLIC surface (gallery-detail owner-bypass, getPublicStylistProfile,
 * demo/test self-heal) is intentionally ACTIVE-ONLY. This is DELIBERATELY narrower than
 * the kernel's MULTI-state notion USER_POLICY.utils.IS_ACCOUNT_STATUS_ACTIVE
 * (status ∈ [ACTIVE, EXPIRING]) — an EXPIRING stylist still works in-app (multi-state =
 * true) but must NOT surface publicly (single-state = false).
 *
 * The EXPIRING row is the tripwire: if isAccountActive were ever widened to the
 * multi-state set, an EXPIRING (soon-to-lapse) stylist's PII would leak onto public
 * reads. This test pins the single-vs-multi divergence so the two can never be conflated.
 */

import { describe, it, expect } from 'vitest';
import { isAccountActive } from './account.config';
import { USER_POLICY } from '@kernel/policies/user.policy';
import { AccountStatusValue } from '@kernel/models/db_models.generated.dto';

const { IS_ACCOUNT_STATUS_ACTIVE } = USER_POLICY.utils;

describe('isAccountActive (single-state, public-visibility)', () => {
  it('true ONLY for ACTIVE', () => {
    expect(isAccountActive(AccountStatusValue.ACTIVE)).toBe(true);
  });

  it('false for EXPIRING (single-state excludes the lapse window)', () => {
    expect(isAccountActive(AccountStatusValue.EXPIRING)).toBe(false);
  });

  it('false for NOT_ACTIVE and EXPIRED', () => {
    expect(isAccountActive(AccountStatusValue.NOT_ACTIVE)).toBe(false);
    expect(isAccountActive(AccountStatusValue.EXPIRED)).toBe(false);
  });
});

describe('isAccountActive vs IS_ACCOUNT_STATUS_ACTIVE — single ≠ multi (NEGATIVE)', () => {
  // The whole reason both exist: EXPIRING diverges. Public visibility (single) hides it;
  // operational access (multi) keeps it. A test that flips here means someone collapsed
  // the two predicates — a PII-leak (if single widened) or an access bug (if multi narrowed).
  it('EXPIRING: single-state false, multi-state true (the divergence)', () => {
    expect(isAccountActive(AccountStatusValue.EXPIRING)).toBe(false);
    expect(IS_ACCOUNT_STATUS_ACTIVE(AccountStatusValue.EXPIRING)).toBe(true);
  });

  it('ACTIVE: both agree (true)', () => {
    expect(isAccountActive(AccountStatusValue.ACTIVE)).toBe(true);
    expect(IS_ACCOUNT_STATUS_ACTIVE(AccountStatusValue.ACTIVE)).toBe(true);
  });

  it('EXPIRED / NOT_ACTIVE: both agree (false)', () => {
    for (const status of [
      AccountStatusValue.EXPIRED,
      AccountStatusValue.NOT_ACTIVE,
    ] as const) {
      expect(isAccountActive(status)).toBe(false);
      expect(IS_ACCOUNT_STATUS_ACTIVE(status)).toBe(false);
    }
  });
});
