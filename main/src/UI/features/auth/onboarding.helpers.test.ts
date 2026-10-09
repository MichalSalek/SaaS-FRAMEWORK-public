import { describe, it, expect, vi } from 'vitest';
import type { UseFormReturn } from 'react-hook-form';
import {
  applyAccountRoleHint,
  isOnboardingRole,
  readPrefilledRole,
  roleHintFromAccounts,
  fieldsForStep,
  selectsPlan,
  totalStepsForRole,
  stepSequenceForRole,
  stepPositionForRole,
  nextStep,
  prevStep,
  isValidInstagramHandle,
  normalizeInstagramHandle,
} from './onboarding.helpers';
import {
  ONBOARDING_DEFAULTS,
  ONBOARDING_STEP,
  TOTAL_ONBOARDING_STEPS_CLIENT,
  TOTAL_ONBOARDING_STEPS_STYLIST,
  type OnboardingFormValues,
} from './onboarding.types';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';

// ---------------------------------------------------------------------------
// ONBOARDING_DEFAULTS — chooser preselection (free-first entry, owner 2026-09-23)
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
// fieldsForStep — keyed to ONBOARDING_STEP (WELCOME=1, ROLE=2, BASIC_INFO=3,
// PREFERENCES=4, CHECKOUT=5).
// ---------------------------------------------------------------------------

describe('fieldsForStep — welcome step', () => {
  it('returns an empty array for the welcome step (no gate)', () => {
    expect(fieldsForStep(ONBOARDING_STEP.WELCOME, 'stylist')).toEqual([]);
    expect(fieldsForStep(ONBOARDING_STEP.WELCOME, 'client')).toEqual([]);
    expect(fieldsForStep(ONBOARDING_STEP.WELCOME, '')).toEqual([]);
  });
});

describe('fieldsForStep — role step', () => {
  // age_confirmed was merged into terms_accepted (one consent row); marketing
  // is optional (stylist-only opt-in) and intentionally NOT validated on "Next".
  it('returns the two required legal-gate fields regardless of role (stylist)', () => {
    expect(fieldsForStep(ONBOARDING_STEP.ROLE, 'stylist')).toEqual([
      'role',
      'terms_accepted',
    ]);
  });

  it('returns the two required legal-gate fields regardless of role (client)', () => {
    expect(fieldsForStep(ONBOARDING_STEP.ROLE, 'client')).toEqual([
      'role',
      'terms_accepted',
    ]);
  });

  it('returns the two required legal-gate fields when role is empty string', () => {
    expect(fieldsForStep(ONBOARDING_STEP.ROLE, '')).toEqual([
      'role',
      'terms_accepted',
    ]);
  });

  it('does NOT validate the optional marketing_consent field', () => {
    expect(fieldsForStep(ONBOARDING_STEP.ROLE, 'stylist')).not.toContain(
      'marketing_consent'
    );
  });
});

describe('fieldsForStep — basic info step', () => {
  it('includes phone for stylist (stylist needs phone)', () => {
    const fields = fieldsForStep(ONBOARDING_STEP.BASIC_INFO, 'stylist');
    expect(fields).toContain('display_name');
    expect(fields).toContain('address_city');
    expect(fields).toContain('phone');
  });

  it('does NOT include phone for client', () => {
    const fields = fieldsForStep(ONBOARDING_STEP.BASIC_INFO, 'client');
    expect(fields).toContain('display_name');
    expect(fields).toContain('address_city');
    expect(fields).not.toContain('phone');
  });

  it('does NOT include phone for empty role', () => {
    const fields = fieldsForStep(ONBOARDING_STEP.BASIC_INFO, '');
    expect(fields).not.toContain('phone');
  });

  it('exact fields for stylist: display_name, address_city, phone, instagram_handle (order preserved)', () => {
    expect(fieldsForStep(ONBOARDING_STEP.BASIC_INFO, 'stylist')).toEqual([
      'display_name',
      'address_city',
      'phone',
      'instagram_handle',
    ]);
  });

  it('exact fields for client: display_name, address_city (no phone)', () => {
    expect(fieldsForStep(ONBOARDING_STEP.BASIC_INFO, 'client')).toEqual([
      'display_name',
      'address_city',
    ]);
  });
});

describe('fieldsForStep — preferences / checkout / degenerate steps', () => {
  it('returns empty array for the preferences step', () => {
    expect(fieldsForStep(ONBOARDING_STEP.PREFERENCES, 'stylist')).toEqual([]);
    expect(fieldsForStep(ONBOARDING_STEP.PREFERENCES, 'client')).toEqual([]);
  });

  it('returns empty array for the checkout step', () => {
    expect(fieldsForStep(ONBOARDING_STEP.CHECKOUT, 'stylist')).toEqual([]);
  });

  it('returns empty array for step 0 (degenerate)', () => {
    expect(fieldsForStep(0, 'stylist')).toEqual([]);
  });

  it('returns empty array for step 99 (degenerate)', () => {
    expect(fieldsForStep(99, 'client')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// selectsPlan / totalStepsForRole
// ---------------------------------------------------------------------------

describe('selectsPlan', () => {
  it('stylist pays (picks a plan)', () => {
    expect(selectsPlan('stylist')).toBe(true);
  });

  it('client never pays', () => {
    expect(selectsPlan('client')).toBe(false);
  });

  it('empty role assumes the longer (paying) flow until a role is picked', () => {
    expect(selectsPlan('')).toBe(true);
  });
});

describe('totalStepsForRole', () => {
  it('stylist gets the full 5-step flow', () => {
    expect(totalStepsForRole('stylist')).toBe(TOTAL_ONBOARDING_STEPS_STYLIST);
    expect(totalStepsForRole('stylist')).toBe(5);
  });

  it('client gets the 3-step flow (no basic-info, no checkout)', () => {
    expect(totalStepsForRole('client')).toBe(TOTAL_ONBOARDING_STEPS_CLIENT);
    expect(totalStepsForRole('client')).toBe(3);
  });

  it('empty role assumes the 5-step flow', () => {
    expect(totalStepsForRole('')).toBe(TOTAL_ONBOARDING_STEPS_STYLIST);
  });
});

// ---------------------------------------------------------------------------
// stepSequenceForRole / nextStep / prevStep / stepPositionForRole
// ---------------------------------------------------------------------------

describe('stepSequenceForRole', () => {
  it('stylist runs all 5 steps in order', () => {
    expect(stepSequenceForRole('stylist')).toEqual([
      ONBOARDING_STEP.WELCOME,
      ONBOARDING_STEP.ROLE,
      ONBOARDING_STEP.BASIC_INFO,
      ONBOARDING_STEP.PREFERENCES,
      ONBOARDING_STEP.CHECKOUT,
    ]);
  });

  it('client skips BASIC_INFO and CHECKOUT', () => {
    expect(stepSequenceForRole('client')).toEqual([
      ONBOARDING_STEP.WELCOME,
      ONBOARDING_STEP.ROLE,
      ONBOARDING_STEP.PREFERENCES,
    ]);
  });

  it('empty role assumes the longer (stylist) sequence', () => {
    expect(stepSequenceForRole('')).toEqual(stepSequenceForRole('stylist'));
  });

  it('stylist without a plan intent ends on PREFERENCES (free-first entry)', () => {
    expect(stepSequenceForRole('stylist', false)).toEqual([
      ONBOARDING_STEP.WELCOME,
      ONBOARDING_STEP.ROLE,
      ONBOARDING_STEP.BASIC_INFO,
      ONBOARDING_STEP.PREFERENCES,
    ]);
    expect(totalStepsForRole('stylist', false)).toBe(4);
    expect(
      stepPositionForRole(ONBOARDING_STEP.PREFERENCES, 'stylist', false)
    ).toBe(4);
    expect(nextStep(ONBOARDING_STEP.PREFERENCES, 'stylist', false)).toBe(
      ONBOARDING_STEP.PREFERENCES
    );
  });

  it('withCheckout does not change the client sequence', () => {
    expect(stepSequenceForRole('client', false)).toEqual(
      stepSequenceForRole('client')
    );
  });
});

describe('nextStep', () => {
  it('client ROLE advances straight to PREFERENCES (skips BASIC_INFO)', () => {
    expect(nextStep(ONBOARDING_STEP.ROLE, 'client')).toBe(
      ONBOARDING_STEP.PREFERENCES
    );
  });

  it('stylist ROLE advances to BASIC_INFO', () => {
    expect(nextStep(ONBOARDING_STEP.ROLE, 'stylist')).toBe(
      ONBOARDING_STEP.BASIC_INFO
    );
  });

  it('clamps at the last step of the flow', () => {
    expect(nextStep(ONBOARDING_STEP.PREFERENCES, 'client')).toBe(
      ONBOARDING_STEP.PREFERENCES
    );
    expect(nextStep(ONBOARDING_STEP.CHECKOUT, 'stylist')).toBe(
      ONBOARDING_STEP.CHECKOUT
    );
  });
});

describe('prevStep', () => {
  it('client PREFERENCES steps back to ROLE (skips BASIC_INFO)', () => {
    expect(prevStep(ONBOARDING_STEP.PREFERENCES, 'client')).toBe(
      ONBOARDING_STEP.ROLE
    );
  });

  it('stylist PREFERENCES steps back to BASIC_INFO', () => {
    expect(prevStep(ONBOARDING_STEP.PREFERENCES, 'stylist')).toBe(
      ONBOARDING_STEP.BASIC_INFO
    );
  });

  it('clamps at the first step (WELCOME)', () => {
    expect(prevStep(ONBOARDING_STEP.WELCOME, 'client')).toBe(
      ONBOARDING_STEP.WELCOME
    );
  });
});

describe('stepPositionForRole', () => {
  it('client PREFERENCES is display-position 3 of 3 (BASIC_INFO skipped)', () => {
    expect(stepPositionForRole(ONBOARDING_STEP.PREFERENCES, 'client')).toBe(3);
  });

  it('stylist PREFERENCES is display-position 4 of 5', () => {
    expect(stepPositionForRole(ONBOARDING_STEP.PREFERENCES, 'stylist')).toBe(4);
  });

  it('unknown step falls back to position 1', () => {
    expect(stepPositionForRole(99, 'client')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// roleHintFromAccounts / applyAccountRoleHint (S122: klientka nie czyta
// powitania stylistki, świeże konto zostaje przy domyślnym lejku)
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

describe('normalizeInstagramHandle / isValidInstagramHandle', () => {
  it('strips „@”, whitespace and unwraps a pasted profile URL', () => {
    expect(normalizeInstagramHandle('  @anna.nails_waw ')).toBe(
      'anna.nails_waw'
    );
    expect(
      normalizeInstagramHandle('https://www.instagram.com/anna.nails/?hl=pl')
    ).toBe('anna.nails');
    expect(normalizeInstagramHandle('instagram.com/@kasia_n')).toBe('kasia_n');
    expect(normalizeInstagramHandle('   ')).toBe('');
  });

  it('takes the account from a story link and rejects post/reel/share links', () => {
    expect(
      normalizeInstagramHandle('https://instagram.com/stories/anna.nails/123')
    ).toBe('anna.nails');
    const reel = normalizeInstagramHandle(
      'https://www.instagram.com/reel/CxAbCd/?igsh=abc'
    );
    expect(isValidInstagramHandle(reel)).toBe(false);
    expect(
      isValidInstagramHandle(
        normalizeInstagramHandle('https://www.instagram.com/p/CxAbCd/')
      )
    ).toBe(false);
  });

  it('accepts Instagram charset up to 30 chars only', () => {
    expect(isValidInstagramHandle('anna.nails_waw')).toBe(true);
    expect(isValidInstagramHandle('anna nails')).toBe(false);
    expect(isValidInstagramHandle('a'.repeat(31))).toBe(false);
  });
});
