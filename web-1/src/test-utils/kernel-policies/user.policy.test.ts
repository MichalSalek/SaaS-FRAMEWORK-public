/**
 * Pure-policy unit test — USER_POLICY payment/activation gate (user.policy.ts).
 *
 * WHAT THIS PROTECTS
 * ──────────────────
 * USER_POLICY.utils holds the three boolean predicates that decide, from a user's
 * stylist_account state, whether the account is ACTIVE, whether the user must PAY to
 * activate, and whether the user is ALLOWED to be active. These feed account-state
 * gates across the app; a flipped comparison or a widened state-set is a silent
 * access/billing bug. This characterizes the CURRENT truth table (green on today's
 * rules) so any rule change shows up as a row flip.
 *
 * RULES UNDER TEST (user.policy.ts + user_and_account.config.ts):
 *   IS_USER_HAS_ACTIVE_ACCOUNT          = has stylist_account AND status ∈ activeAccountStates
 *                                         (activeAccountStates = [ACTIVE, EXPIRING])
 *   IS_USER_NEED_TO_PAY_TO_ACTIVATE_... = status === NOT_ACTIVE AND payment === UNPAID
 *   CAN_USER_HAVE_ACTIVE_ACCOUNT        = payment === PAID
 *
 * METHOD: pure — imports `@kernel/policies/user.policy` only (no harness mocks).
 * Inputs built from the typed `makeStylistCurrentUser` / `makeClientCurrentUser`
 * fixtures so the user shape stays in lockstep with the kernel models at tsc time.
 */

import { describe, it, expect } from 'vitest';
import { USER_POLICY } from '@kernel/policies/user.policy';
import {
  AccountStatusValue,
  PaymentStatusValue,
} from '@kernel/models/db_models.generated.dto';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { makeStylistCurrentUser, makeClientCurrentUser } from '../fixtures';

const {
  IS_ACCOUNT_STATUS_ACTIVE,
  IS_USER_HAS_ACTIVE_ACCOUNT,
  IS_USER_NEED_TO_PAY_TO_ACTIVATE_ACCOUNT,
  CAN_USER_HAVE_ACTIVE_ACCOUNT,
} = USER_POLICY.utils;

describe('USER_POLICY.utils.IS_ACCOUNT_STATUS_ACTIVE (bare-status, multi-state)', () => {
  // Status-level SSOT for the operationally-active set ([ACTIVE, EXPIRING]). The
  // user-level IS_USER_HAS_ACTIVE_ACCOUNT delegates to the same membership rule, so
  // this row table mirrors that one for a bare AccountStatus (no user wrapper).
  it('true for ACTIVE and EXPIRING (the active set)', () => {
    expect(IS_ACCOUNT_STATUS_ACTIVE(AccountStatusValue.ACTIVE)).toBe(true);
    expect(IS_ACCOUNT_STATUS_ACTIVE(AccountStatusValue.EXPIRING)).toBe(true);
  });

  it('false for NOT_ACTIVE and EXPIRED (outside the active set)', () => {
    expect(IS_ACCOUNT_STATUS_ACTIVE(AccountStatusValue.NOT_ACTIVE)).toBe(false);
    expect(IS_ACCOUNT_STATUS_ACTIVE(AccountStatusValue.EXPIRED)).toBe(false);
  });
});

// A stylist whose account state we fully control per case.
const stylistWith = (
  account_status: (typeof AccountStatusValue)[keyof typeof AccountStatusValue],
  payment_status: (typeof PaymentStatusValue)[keyof typeof PaymentStatusValue]
) => makeStylistCurrentUser({ account: { account_status, payment_status } });

describe('USER_POLICY.utils.IS_USER_HAS_ACTIVE_ACCOUNT (active-state membership)', () => {
  // activeAccountStates = [ACTIVE, EXPIRING] → these two are the ONLY true cases.
  it('true for ACTIVE', () => {
    expect(
      IS_USER_HAS_ACTIVE_ACCOUNT({
        user: stylistWith(AccountStatusValue.ACTIVE, PaymentStatusValue.PAID),
      })
    ).toBe(true);
  });

  it('true for EXPIRING (still inside the active set)', () => {
    expect(
      IS_USER_HAS_ACTIVE_ACCOUNT({
        user: stylistWith(AccountStatusValue.EXPIRING, PaymentStatusValue.PAID),
      })
    ).toBe(true);
  });

  it('false for NOT_ACTIVE and EXPIRED (outside the active set)', () => {
    expect(
      IS_USER_HAS_ACTIVE_ACCOUNT({
        user: stylistWith(
          AccountStatusValue.NOT_ACTIVE,
          PaymentStatusValue.PAID
        ),
      })
    ).toBe(false);
    expect(
      IS_USER_HAS_ACTIVE_ACCOUNT({
        user: stylistWith(AccountStatusValue.EXPIRED, PaymentStatusValue.PAID),
      })
    ).toBe(false);
  });

  it('false when there is no stylist_account (a client user)', () => {
    // Client has client_account but no stylist_account → predicate is stylist-scoped.
    expect(IS_USER_HAS_ACTIVE_ACCOUNT({ user: makeClientCurrentUser() })).toBe(
      false
    );
  });

  it('false for undefined user (guarded against null/undefined)', () => {
    expect(IS_USER_HAS_ACTIVE_ACCOUNT({ user: undefined })).toBe(false);
  });

  // REGRESSION GUARD: activeAccountStates is the SSOT for the "active" set. If EXPIRED
  // were added there, the EXPIRED assertion above flips true → access leak for expired
  // accounts. If EXPIRING were removed, the EXPIRING test flips false.
});

describe('USER_POLICY.utils.IS_USER_NEED_TO_PAY_TO_ACTIVATE_ACCOUNT (NOT_ACTIVE + UNPAID gate)', () => {
  it('true ONLY when status === NOT_ACTIVE AND payment === UNPAID', () => {
    expect(
      IS_USER_NEED_TO_PAY_TO_ACTIVATE_ACCOUNT({
        user: stylistWith(
          AccountStatusValue.NOT_ACTIVE,
          PaymentStatusValue.UNPAID
        ),
      })
    ).toBe(true);
  });

  it('false when NOT_ACTIVE but already PAID (payment clause fails)', () => {
    expect(
      IS_USER_NEED_TO_PAY_TO_ACTIVATE_ACCOUNT({
        user: stylistWith(
          AccountStatusValue.NOT_ACTIVE,
          PaymentStatusValue.PAID
        ),
      })
    ).toBe(false);
  });

  it('false when UNPAID but status is ACTIVE (status clause fails)', () => {
    expect(
      IS_USER_NEED_TO_PAY_TO_ACTIVATE_ACCOUNT({
        user: stylistWith(AccountStatusValue.ACTIVE, PaymentStatusValue.UNPAID),
      })
    ).toBe(false);
  });

  it('false for EXPIRED + UNPAID (only NOT_ACTIVE, not EXPIRED, triggers the pay-gate)', () => {
    expect(
      IS_USER_NEED_TO_PAY_TO_ACTIVATE_ACCOUNT({
        user: stylistWith(
          AccountStatusValue.EXPIRED,
          PaymentStatusValue.UNPAID
        ),
      })
    ).toBe(false);
  });

  it('false for a client user (no stylist_account → optional chain short-circuits)', () => {
    expect(
      IS_USER_NEED_TO_PAY_TO_ACTIVATE_ACCOUNT({ user: makeClientCurrentUser() })
    ).toBe(false);
  });

  it('false for undefined user', () => {
    expect(IS_USER_NEED_TO_PAY_TO_ACTIVATE_ACCOUNT({ user: undefined })).toBe(
      false
    );
  });

  // REGRESSION GUARD: this is an AND of two clauses. Loosening either (e.g. dropping
  // the UNPAID check, or matching EXPIRED too) widens who is told to pay — the
  // NOT_ACTIVE+PAID and ACTIVE+UNPAID rows are the tripwires for each clause.
});

describe('USER_POLICY.utils.CAN_USER_HAVE_ACTIVE_ACCOUNT (PAID or onboarded Free)', () => {
  it('true when payment_status === PAID (regardless of account_status)', () => {
    // Eligibility, not current activeness: even NOT_ACTIVE returns true when PAID.
    expect(
      CAN_USER_HAVE_ACTIVE_ACCOUNT({
        user: stylistWith(
          AccountStatusValue.NOT_ACTIVE,
          PaymentStatusValue.PAID
        ),
      })
    ).toBe(true);
  });

  it('true for an onboarded Free account (FREE + plan_selected_at set) despite UNPAID', () => {
    // Free tier is legitimately ACTIVE (public profile online) with payment_status=UNPAID;
    // eligibility must include it so admin disable→enable / recovery restores visibility.
    expect(
      CAN_USER_HAVE_ACTIVE_ACCOUNT({
        user: makeStylistCurrentUser({
          account: {
            account_status: AccountStatusValue.NOT_ACTIVE,
            payment_status: PaymentStatusValue.UNPAID,
            pricing_plan: PricingPlanValue.FREE,
            plan_selected_at: new Date('2026-01-01T00:00:00.000Z'),
          },
        }),
      })
    ).toBe(true);
  });

  it('false for a not-yet-onboarded Free account (plan_selected_at null)', () => {
    // The plan_selected_at guard keeps a never-configured account (default pricing_plan
    // before plan-select) from being surfaced as active on reactivation.
    expect(
      CAN_USER_HAVE_ACTIVE_ACCOUNT({
        user: makeStylistCurrentUser({
          account: {
            account_status: AccountStatusValue.NOT_ACTIVE,
            payment_status: PaymentStatusValue.UNPAID,
            pricing_plan: PricingPlanValue.FREE,
            plan_selected_at: null,
          },
        }),
      })
    ).toBe(false);
  });

  it('false for a non-Free unpaid plan (UNPAID / IN_PROGRESS / REJECTED on a paid tier)', () => {
    // stylistWith defaults to pricing_plan=PRO, so these stay false: a paid-tier account
    // without a settled payment is NOT eligible (half-finished / failed / lapsed billing).
    for (const payment of [
      PaymentStatusValue.UNPAID,
      PaymentStatusValue.IN_PROGRESS,
      PaymentStatusValue.REJECTED,
    ] as const) {
      expect(
        CAN_USER_HAVE_ACTIVE_ACCOUNT({
          user: stylistWith(AccountStatusValue.ACTIVE, payment),
        })
      ).toBe(false);
    }
  });

  it('false for a client user (no stylist_account)', () => {
    expect(
      CAN_USER_HAVE_ACTIVE_ACCOUNT({ user: makeClientCurrentUser() })
    ).toBe(false);
  });

  it('false for undefined user', () => {
    expect(CAN_USER_HAVE_ACTIVE_ACCOUNT({ user: undefined })).toBe(false);
  });

  // REGRESSION GUARD: eligibility = PAID OR (FREE AND plan_selected_at≠null). The paid
  // boundary stays strict equality on PAID (IN_PROGRESS / REJECTED must not grant it), and
  // the Free branch is gated on plan_selected_at so a not-yet-onboarded account never flips
  // true. Keep in lockstep with cascadeBulkEnableAccountStatus (Prisma WHERE replica).
});
