import { describe, expect, it } from 'vitest';
import {
  resolveRemoveVariant,
  resolveSalonStaffView,
  type SalonStaffViewInput,
} from './salonStaffView.helpers';

function input(overrides: Partial<SalonStaffViewInput> = {}) {
  return resolveSalonStaffView({
    isPlanKnown: true,
    canUseStaffAccounts: true,
    isRosterLoading: false,
    isRosterError: false,
    isRosterFetched: true,
    memberCount: 2,
    ...overrides,
  });
}

describe('resolveSalonStaffView', () => {
  it('staff plan with members: full list with seat usage, nothing locked', () => {
    expect(input()).toEqual({
      showSeatUsage: true,
      showEmptyState: false,
      showStaffList: true,
      showLockedNotice: false,
      showRemoveOnlyList: false,
      showRosterError: false,
    });
  });

  it('staff plan without members: empty state', () => {
    const view = input({ memberCount: 0 });
    expect(view.showEmptyState).toBe(true);
    expect(view.showStaffList).toBe(false);
  });

  it('plan without staff accounts and a leftover team: notice plus remove-only list, no seats', () => {
    expect(input({ canUseStaffAccounts: false })).toEqual({
      showSeatUsage: false,
      showEmptyState: false,
      showStaffList: false,
      showLockedNotice: true,
      showRemoveOnlyList: true,
      showRosterError: false,
    });
  });

  it('plan without staff accounts and no team: only the notice (unchanged)', () => {
    const view = input({ canUseStaffAccounts: false, memberCount: 0 });
    expect(view.showLockedNotice).toBe(true);
    expect(view.showRemoveOnlyList).toBe(false);
    expect(view.showEmptyState).toBe(false);
  });

  it('plan without staff accounts, roster failed with no data: notice plus error, never an empty list', () => {
    const view = input({
      canUseStaffAccounts: false,
      isRosterError: true,
      isRosterFetched: false,
      memberCount: 0,
    });
    expect(view.showLockedNotice).toBe(true);
    expect(view.showRosterError).toBe(true);
    expect(view.showRemoveOnlyList).toBe(false);
  });

  it('failed refetch over a cached team keeps the remove-only list and hides the error', () => {
    const view = input({ canUseStaffAccounts: false, isRosterError: true });
    expect(view.showRemoveOnlyList).toBe(true);
    expect(view.showRosterError).toBe(false);
  });

  it('failed refetch over an EMPTY cached roster counts as unknown', () => {
    const view = input({ isRosterError: true, memberCount: 0 });
    expect(view.showEmptyState).toBe(false);
    expect(view.showSeatUsage).toBe(false);
    expect(view.showRosterError).toBe(true);
  });

  it('first load: no notice, no list', () => {
    const view = input({
      canUseStaffAccounts: false,
      isRosterLoading: true,
      isRosterFetched: false,
      memberCount: 0,
    });
    expect(view.showLockedNotice).toBe(false);
    expect(view.showRemoveOnlyList).toBe(false);
  });

  it('plan unknown: nothing plan-dependent renders (no locked flash)', () => {
    const view = input({ isPlanKnown: false, canUseStaffAccounts: false });
    expect(view.showLockedNotice).toBe(false);
    expect(view.showRemoveOnlyList).toBe(false);
    expect(view.showStaffList).toBe(false);
    expect(view.showSeatUsage).toBe(false);
  });
});

describe('resolveRemoveVariant', () => {
  it('live member: plain removal in both modes', () => {
    expect(resolveRemoveVariant({ user_inactive: false }, false)).toBe(
      'remove'
    );
    expect(resolveRemoveVariant({ user_inactive: false }, true)).toBe('remove');
    expect(resolveRemoveVariant(null, true)).toBe('remove');
  });

  it('dead-user row: frees a seat on a staff plan, plain removal without seats', () => {
    expect(resolveRemoveVariant({ user_inactive: true }, false)).toBe(
      'freeSlot'
    );
    expect(resolveRemoveVariant({ user_inactive: true }, true)).toBe(
      'removeInactive'
    );
  });
});
