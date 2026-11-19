import { describe, it, expect, vi } from 'vitest';
import type { UseFormReturn } from 'react-hook-form';
import {
  applyAccountRoleHint,
  isOnboardingRole,
  readPrefilledRole,
  roleHintFromAccounts,
  selectsPlan,
  stylistSuccessOffersPaidPlan,
  totalStepsForRole,
  stepSequenceForRole,
  stepPositionForRole,
  publicNameFromAccount,
} from './onboarding.helpers';
import {
  ONBOARDING_DEFAULTS,
  ONBOARDING_STEP,
  type OnboardingFormValues,
} from './onboarding.types';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';

// ---------------------------------------------------------------------------
// ONBOARDING_DEFAULTS — chooser preselection (free-first entry, owner)
// ---------------------------------------------------------------------------

describe('ONBOARDING_DEFAULTS — chooser preselection', () => {
  it('the chooser (funnel or Free-activation fallback) pre-selects PRO', () => {
    expect(ONBOARDING_DEFAULTS.selected_plan_id).toBe(PricingPlanValue.PRO);
  });

  it('defaults to monthly billing (lower commitment threshold for the trial)', () => {
    expect(ONBOARDING_DEFAULTS.billing_period).toBe('month');
  });
});

// ---------------------------------------------------------------------------
// isOnboardingRole
// ---------------------------------------------------------------------------

describe('isOnboardingRole', () => {
  it('returns true for "stylist"', () => {
    expect(isOnboardingRole('stylist')).toBe(true);
  });

  it('returns true for "client"', () => {
    expect(isOnboardingRole('client')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isOnboardingRole('')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isOnboardingRole(undefined)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isOnboardingRole(null)).toBe(false);
  });

  it('returns false for arbitrary string', () => {
    expect(isOnboardingRole('admin')).toBe(false);
  });

  it('returns false for uppercase STYLIST', () => {
    expect(isOnboardingRole('STYLIST')).toBe(false);
  });

  it('returns false for number', () => {
    expect(isOnboardingRole(1)).toBe(false);
  });

  it('returns false for object', () => {
    expect(isOnboardingRole({ role: 'stylist' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// readPrefilledRole
// ---------------------------------------------------------------------------

describe('readPrefilledRole', () => {
  it('returns "stylist" when query.role = "stylist"', () => {
    expect(readPrefilledRole({ role: 'stylist' })).toBe('stylist');
  });

  it('returns "client" when query.role = "client"', () => {
    expect(readPrefilledRole({ role: 'client' })).toBe('client');
  });

  it('returns null when query.role is absent', () => {
    expect(readPrefilledRole({})).toBeNull();
  });

  it('returns null when query.role is undefined', () => {
    expect(readPrefilledRole({ role: undefined })).toBeNull();
  });

  it('returns null for invalid role string', () => {
    expect(readPrefilledRole({ role: 'admin' })).toBeNull();
  });

  it('returns null for empty string role', () => {
    expect(readPrefilledRole({ role: '' })).toBeNull();
  });

  it('uses first element when query.role is an array containing "stylist"', () => {
    expect(readPrefilledRole({ role: ['stylist', 'client'] })).toBe('stylist');
  });

  it('uses first element when query.role is an array containing "client"', () => {
    expect(readPrefilledRole({ role: ['client', 'stylist'] })).toBe('client');
  });

  it('returns null when array first element is invalid', () => {
    expect(readPrefilledRole({ role: ['admin', 'stylist'] })).toBeNull();
  });

  it('returns null when array is empty (undefined first element)', () => {
    // Array.isArray([]) → true; [undefined][0] → undefined → not valid role
    expect(readPrefilledRole({ role: [] })).toBeNull();
  });

  it('ignores unrelated query params', () => {
    expect(readPrefilledRole({ foo: 'bar', role: 'stylist' })).toBe('stylist');
  });
});

// ---------------------------------------------------------------------------
// Step model — role-only onboarding (owner): ROLE, plus CHECKOUT for
// a stylist with an explicit plan intent.
// ---------------------------------------------------------------------------

describe('stylistSuccessOffersPaidPlan', () => {
  it('offers a paid plan only when the completed plan is confirmed Free', () => {
    expect(stylistSuccessOffersPaidPlan(PricingPlanValue.FREE)).toBe(true);
  });

  it('does not label a paid, trial or unknown completion as Free', () => {
    expect(stylistSuccessOffersPaidPlan(PricingPlanValue.PRO)).toBe(false);
    expect(stylistSuccessOffersPaidPlan(PricingPlanValue.STUDIO)).toBe(false);
    expect(stylistSuccessOffersPaidPlan(null)).toBe(false);
  });
});

describe('selectsPlan', () => {
  it('a stylist (and a not-yet-picked role) takes the longer flow', () => {
    expect(selectsPlan('stylist')).toBe(true);
    expect(selectsPlan('')).toBe(true);
  });

  it('a client never reaches a plan', () => {
    expect(selectsPlan('client')).toBe(false);
  });
});

describe('stepSequenceForRole', () => {
  it('client: the role screen only', () => {
    expect(stepSequenceForRole('client')).toEqual([ONBOARDING_STEP.ROLE]);
  });

  it('stylist with a plan intent: role, then the plan', () => {
    expect(stepSequenceForRole('stylist', true)).toEqual([
      ONBOARDING_STEP.ROLE,
      ONBOARDING_STEP.CHECKOUT,
    ]);
  });

  it('stylist without a plan intent: the role screen only (Free starts in place)', () => {
    expect(stepSequenceForRole('stylist', false)).toEqual([
      ONBOARDING_STEP.ROLE,
    ]);
    expect(totalStepsForRole('stylist', false)).toBe(1);
  });
});

describe('stepPositionForRole', () => {
  it('counts the plan step as the second one for a stylist with intent', () => {
    expect(stepPositionForRole(ONBOARDING_STEP.CHECKOUT, 'stylist', true)).toBe(
      2
    );
  });
});

// ---------------------------------------------------------------------------
// publicNameFromAccount — the account name seeds the public name
// ---------------------------------------------------------------------------

describe('publicNameFromAccount', () => {
  it('uses a Google account name, trimmed', () => {
    expect(publicNameFromAccount('  Dominika S ')).toBe('Dominika S');
  });

  it('gives null when there is no usable name (magic-link signup, too short)', () => {
    for (const name of [undefined, null, '', '   ', 'Al']) {
      expect(publicNameFromAccount(name)).toBeNull();
    }
  });

  it('caps a very long name at the public-name maximum', () => {
    expect(publicNameFromAccount('x'.repeat(150))?.length).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// roleHintFromAccounts / applyAccountRoleHint (a client does not read the stylist
// welcome, a fresh account stays on the default funnel)
// ---------------------------------------------------------------------------

type AccountsView = Parameters<typeof roleHintFromAccounts>[0];

function accounts(stylist: boolean, client: boolean): AccountsView {
  // Only presence matters to the helper; the account payloads are opaque here.
  return {
    stylist_account: stylist ? {} : null,
    client_account: client ? {} : null,
  } as unknown as AccountsView;
}

describe('roleHintFromAccounts', () => {
  it('returns null while the account query has not delivered a user', () => {
    expect(roleHintFromAccounts(undefined)).toBeNull();
  });

  it('returns null for a fresh signup (no account yet, account_type is only the column default)', () => {
    expect(roleHintFromAccounts(accounts(false, false))).toBeNull();
  });

  it('returns "client" for a user who owns only a ClientAccount', () => {
    expect(roleHintFromAccounts(accounts(false, true))).toBe('client');
  });

  it('returns "stylist" for a user who owns only a StylistAccount', () => {
    expect(roleHintFromAccounts(accounts(true, false))).toBe('stylist');
  });

  it('prefers "stylist" when both exist (the plan gate is what sent them here)', () => {
    expect(roleHintFromAccounts(accounts(true, true))).toBe('stylist');
  });
});

describe('applyAccountRoleHint', () => {
  function fakeForm(isDirty: boolean) {
    const setValue = vi.fn();
    const methods = {
      getFieldState: () => ({ isDirty }),
      setValue,
    } as unknown as UseFormReturn<OnboardingFormValues>;
    return { methods, setValue };
  }

  it('seeds a pristine role field with the account hint', () => {
    const { methods, setValue } = fakeForm(false);
    applyAccountRoleHint(methods, 'client', null, false);
    expect(setValue).toHaveBeenCalledWith('role', 'client');
  });

  it('never overrides a role the user already touched', () => {
    const { methods, setValue } = fakeForm(true);
    applyAccountRoleHint(methods, 'client', null, false);
    expect(setValue).not.toHaveBeenCalled();
  });

  it('yields to an explicit ?role= hint', () => {
    const { methods, setValue } = fakeForm(false);
    applyAccountRoleHint(methods, 'client', 'stylist', false);
    expect(setValue).not.toHaveBeenCalled();
  });

  it('yields to a pricing funnel (stylist intent)', () => {
    const { methods, setValue } = fakeForm(false);
    applyAccountRoleHint(methods, 'client', null, true);
    expect(setValue).not.toHaveBeenCalled();
  });

  it('does nothing without a hint', () => {
    const { methods, setValue } = fakeForm(false);
    applyAccountRoleHint(methods, null, null, false);
    expect(setValue).not.toHaveBeenCalled();
  });
});
