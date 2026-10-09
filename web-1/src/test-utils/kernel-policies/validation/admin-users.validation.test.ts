/**
 * Characterization tests for adminUsersValidators (FWE Wave H, FAZA 1).
 *
 * These lock the CURRENT behavior of the kernel admin-user request validators as the
 * safety net the zod migration (FAZA 2) MUST preserve. Every assertion below is GREEN
 * against the hand-written validators in
 * `.shared-kernel/policies/validation/admin-users.validation.ts`, so a zod rewrite that
 * changes a field's accept/reject decision (or which field carries the error) flips a test.
 *
 * They assert validation LOGIC (which field is rejected, __isValid), NOT exact i18n message
 * text (brittle): a rejected field is asserted via a non-empty error string (`rejected`),
 * an accepted payload via `__isValid === true`.
 *
 * SECURITY-CRITICAL — these are the admin destructive surfaces (delete/disable/purge/
 * bulk-disable/bulk-logout/plan-change). Bounds (MAX_USER_IDS), id-string discipline and
 * the pricing-plan allowlist below are exactly what a zod migration must not loosen.
 *
 * Valid/boundary inputs are DERIVED from SSOT (VALIDATION_BULK.MAX_USER_IDS,
 * PricingPlanValue), not hardcoded, so a cap change in the config moves these in lockstep.
 *
 * The validators reach runtime via VALIDATION_POLICY.validators (admin-users → admin →
 * policy spread chain), so they are exercised exactly as the handlers call them.
 */
import { describe, it, expect } from 'vitest';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { VALIDATION_BULK } from '@kernel/policies/validation.config';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';

const V = VALIDATION_POLICY.validators;
const SOME_PRICING_PLAN = PricingPlanValue.PRO as string;

// Helper: a field is "rejected" when its accumulated error string is non-empty.
const rejected = (r: Record<string, unknown>, field: string): boolean =>
  typeof r[field] === 'string' && (r[field] as string).trim().length > 0;

// ── id-only validators sharing the same shape (id present + string) ──
describe('adminUsersValidators.deleteOrDisableOtherUser (field: id)', () => {
  it('accepts a string id', () => {
    const r = V.deleteOrDisableOtherUser({ id: 'user-1' });
    expect(r.__isValid).toBe(true);
  });

  it('SECURITY: rejects a missing id key', () => {
    const r = V.deleteOrDisableOtherUser({});
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'id')).toBe(true);
  });

  // SURPRISE (characterized, not endorsed): these three "presence + typeof string"
  // validators (deleteOrDisableOtherUser / enableOtherUser / purgeDeletedUser) gate on
  // `'id' in data` + `typeof === 'string'` only — an EMPTY string is a string with the key
  // present, so it PASSES. This diverges from the validateRequiredId-backed siblings
  // (deleteSession / adminBecomeUser) which reject '' via a falsy check. A zod migration
  // must KEEP this exact split (or consciously tighten it); locked here as the current truth.
  it('ACCEPTS an empty-string id (presence+type gate only, NOT a falsy check)', () => {
    const r = V.deleteOrDisableOtherUser({ id: '' });
    expect(r.__isValid).toBe(true);
  });

  it('SECURITY: rejects a non-string id (number)', () => {
    const r = V.deleteOrDisableOtherUser({ id: 123 as unknown as string });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'id')).toBe(true);
  });

  it('rejects null / undefined / non-object payloads', () => {
    expect(V.deleteOrDisableOtherUser(null).__isValid).toBe(false);
    expect(V.deleteOrDisableOtherUser(undefined).__isValid).toBe(false);
    expect(V.deleteOrDisableOtherUser('x' as unknown).__isValid).toBe(false);
  });
});

describe('adminUsersValidators.enableOtherUser (field: id)', () => {
  // Same presence+type gate as deleteOrDisableOtherUser: empty string PASSES (see SURPRISE note above).
  it('accepts a string id (incl. empty), rejects missing / non-string / null', () => {
    expect(V.enableOtherUser({ id: 'user-1' }).__isValid).toBe(true);
    expect(V.enableOtherUser({ id: '' }).__isValid).toBe(true); // empty string passes (NOT a falsy check)
    expect(rejected(V.enableOtherUser({}), 'id')).toBe(true);
    expect(
      rejected(V.enableOtherUser({ id: 5 as unknown as string }), 'id')
    ).toBe(true);
    expect(V.enableOtherUser(null).__isValid).toBe(false);
  });
});

describe('adminUsersValidators.purgeDeletedUser (field: user_id)', () => {
  it('accepts a string user_id', () => {
    expect(V.purgeDeletedUser({ user_id: 'user-1' }).__isValid).toBe(true);
  });

  // Same presence+type gate: empty-string user_id PASSES (see SURPRISE note above).
  it('SECURITY: rejects missing / non-string user_id on field user_id (empty string PASSES)', () => {
    expect(V.purgeDeletedUser({ user_id: '' }).__isValid).toBe(true); // empty string passes
    expect(rejected(V.purgeDeletedUser({}), 'user_id')).toBe(true);
    expect(
      rejected(
        V.purgeDeletedUser({ user_id: 1 as unknown as string }),
        'user_id'
      )
    ).toBe(true);
  });

  it('rejects null / undefined / non-object payloads', () => {
    expect(V.purgeDeletedUser(null).__isValid).toBe(false);
    expect(V.purgeDeletedUser(undefined).__isValid).toBe(false);
  });
});

// ── validateRequiredId-backed validators (field: id) ──
describe('adminUsersValidators.deleteSession (field: id, via validateRequiredId)', () => {
  it('accepts a string id, rejects falsy / non-string', () => {
    expect(V.deleteSession({ id: 'sess-1' }).__isValid).toBe(true);
    expect(rejected(V.deleteSession({ id: '' }), 'id')).toBe(true);
    expect(rejected(V.deleteSession({}), 'id')).toBe(true);
    expect(
      rejected(V.deleteSession({ id: 0 as unknown as string }), 'id')
    ).toBe(true);
    // validateRequiredId is null-safe (typedData?.id)
    expect(V.deleteSession(null).__isValid).toBe(false);
    expect(V.deleteSession(undefined).__isValid).toBe(false);
  });
});

describe('adminUsersValidators.adminBecomeUser (field: id, via validateRequiredId)', () => {
  it('SECURITY: accepts a string id, rejects falsy / non-string / null', () => {
    expect(V.adminBecomeUser({ id: 'target-1' }).__isValid).toBe(true);
    expect(rejected(V.adminBecomeUser({ id: '' }), 'id')).toBe(true);
    expect(rejected(V.adminBecomeUser({}), 'id')).toBe(true);
    expect(
      rejected(V.adminBecomeUser({ id: true as unknown as string }), 'id')
    ).toBe(true);
    expect(V.adminBecomeUser(null).__isValid).toBe(false);
  });
});

// ── plan-change validator (fields: id + pricing_plan) ──
describe('adminUsersValidators.adminChangePricingPlan (fields: id, pricing_plan)', () => {
  it('accepts a string id + valid pricing_plan', () => {
    const r = V.adminChangePricingPlan({
      id: 'user-1',
      pricing_plan: SOME_PRICING_PLAN,
    });
    expect(r.__isValid).toBe(true);
  });

  it('SECURITY: rejects a non-string / empty id on field id', () => {
    expect(
      rejected(
        V.adminChangePricingPlan({ id: '', pricing_plan: SOME_PRICING_PLAN }),
        'id'
      )
    ).toBe(true);
    expect(
      rejected(
        V.adminChangePricingPlan({
          id: 9 as unknown as string,
          pricing_plan: SOME_PRICING_PLAN,
        }),
        'id'
      )
    ).toBe(true);
  });

  it('SECURITY: rejects a missing pricing_plan on field pricing_plan', () => {
    const r = V.adminChangePricingPlan({
      id: 'user-1',
      pricing_plan: '' as unknown as string,
    });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'pricing_plan')).toBe(true);
  });

  it('SECURITY: rejects a pricing_plan outside the PricingPlanValue allowlist', () => {
    for (const bad of [
      'ENTERPRISE',
      'free',
      'pro',
      'ADMIN',
      'PRO ',
      '__proto__',
    ]) {
      const r = V.adminChangePricingPlan({
        id: 'user-1',
        pricing_plan: bad as unknown as string,
      });
      expect(r.__isValid, `pricing_plan=${bad}`).toBe(false);
      expect(rejected(r, 'pricing_plan'), `pricing_plan=${bad}`).toBe(true);
    }
  });

  it('accepts every plan in the PricingPlanValue SSOT', () => {
    for (const plan of Object.values(PricingPlanValue)) {
      const r = V.adminChangePricingPlan({ id: 'user-1', pricing_plan: plan });
      expect(r.__isValid, `pricing_plan=${plan}`).toBe(true);
    }
  });
});

// ── bulk validators: identical user_ids shape (disable / enable / logout) ──
const bulkUserIdsValidators = {
  adminBulkDisable: V.adminBulkDisable,
  adminBulkEnable: V.adminBulkEnable,
  adminBulkLogout: V.adminBulkLogout,
} as const;

for (const [name, validate] of Object.entries(bulkUserIdsValidators)) {
  describe(`adminUsersValidators.${name} (field: user_ids)`, () => {
    it('accepts a non-empty array of string ids', () => {
      expect(validate({ user_ids: ['a', 'b', 'c'] }).__isValid).toBe(true);
    });

    it('accepts exactly MAX_USER_IDS ids (boundary)', () => {
      const atCap = Array.from(
        { length: VALIDATION_BULK.MAX_USER_IDS },
        (_, i) => `u${i}`
      );
      expect(validate({ user_ids: atCap }).__isValid).toBe(true);
    });

    it('SECURITY: rejects more than MAX_USER_IDS ids (DoS / mass-action cap)', () => {
      const overCap = Array.from(
        { length: VALIDATION_BULK.MAX_USER_IDS + 1 },
        (_, i) => `u${i}`
      );
      const r = validate({ user_ids: overCap });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'user_ids')).toBe(true);
    });

    it('SECURITY: rejects an empty array on field user_ids', () => {
      const r = validate({ user_ids: [] });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'user_ids')).toBe(true);
    });

    it('SECURITY: rejects a non-array user_ids', () => {
      expect(
        rejected(validate({ user_ids: 'a' as unknown as string[] }), 'user_ids')
      ).toBe(true);
      expect(rejected(validate({}), 'user_ids')).toBe(true);
      expect(validate(null).__isValid).toBe(false);
    });

    it('SECURITY: rejects an array containing a non-string or empty-string id', () => {
      expect(
        rejected(
          validate({ user_ids: ['a', 123 as unknown as string] }),
          'user_ids'
        )
      ).toBe(true);
      expect(rejected(validate({ user_ids: ['a', ''] }), 'user_ids')).toBe(
        true
      );
    });
  });
}

// ── bulk plan-change: user_ids + pricing_plan ──
describe('adminUsersValidators.adminBulkChangePlan (fields: user_ids, pricing_plan)', () => {
  const validIds = ['a', 'b'];

  it('accepts non-empty string ids + valid pricing_plan', () => {
    const r = V.adminBulkChangePlan({
      user_ids: validIds,
      pricing_plan: SOME_PRICING_PLAN,
    });
    expect(r.__isValid).toBe(true);
  });

  it('SECURITY: rejects over-cap user_ids on field user_ids', () => {
    const overCap = Array.from(
      { length: VALIDATION_BULK.MAX_USER_IDS + 1 },
      (_, i) => `u${i}`
    );
    const r = V.adminBulkChangePlan({
      user_ids: overCap,
      pricing_plan: SOME_PRICING_PLAN,
    });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'user_ids')).toBe(true);
  });

  it('SECURITY: rejects empty / non-array / dirty user_ids', () => {
    expect(
      rejected(
        V.adminBulkChangePlan({
          user_ids: [],
          pricing_plan: SOME_PRICING_PLAN,
        }),
        'user_ids'
      )
    ).toBe(true);
    expect(
      rejected(
        V.adminBulkChangePlan({
          user_ids: 'x' as unknown as string[],
          pricing_plan: SOME_PRICING_PLAN,
        }),
        'user_ids'
      )
    ).toBe(true);
    expect(
      rejected(
        V.adminBulkChangePlan({
          user_ids: ['a', ''],
          pricing_plan: SOME_PRICING_PLAN,
        }),
        'user_ids'
      )
    ).toBe(true);
  });

  it('SECURITY: rejects a missing pricing_plan on field pricing_plan', () => {
    const r = V.adminBulkChangePlan({
      user_ids: validIds,
      pricing_plan: '' as unknown as string,
    });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'pricing_plan')).toBe(true);
  });

  it('SECURITY: rejects a pricing_plan outside the allowlist on field pricing_plan', () => {
    for (const bad of ['ENTERPRISE', 'pro', 'ADMIN', '__proto__']) {
      const r = V.adminBulkChangePlan({
        user_ids: validIds,
        pricing_plan: bad as unknown as string,
      });
      expect(r.__isValid, `pricing_plan=${bad}`).toBe(false);
      expect(rejected(r, 'pricing_plan'), `pricing_plan=${bad}`).toBe(true);
    }
  });

  it('accepts every plan in the PricingPlanValue SSOT', () => {
    for (const plan of Object.values(PricingPlanValue)) {
      expect(
        V.adminBulkChangePlan({ user_ids: validIds, pricing_plan: plan })
          .__isValid,
        `pricing_plan=${plan}`
      ).toBe(true);
    }
  });
});
