import { describe, expect, it } from 'vitest';
import type { FeatureFlagItem } from './hooks/useAdminFeatureFlags';
import {
  getRetirementStatus,
  groupFlags,
  isOverdue,
} from './feature-flags.model';

const NOW = new Date('2026-10-09T12:00:00.000Z').getTime();
const DAY = 86_400_000;
const at = (days: number): string => new Date(NOW + days * DAY).toISOString();

const flag = (key: string, expiresAt: string | null = null): FeatureFlagItem =>
  ({
    id: key,
    key,
    is_enabled: true,
    description: null,
    updated_at: at(0),
    expires_at: expiresAt,
  }) as FeatureFlagItem;

describe('feature flag retirement', () => {
  it('has no status without an expiry date', () => {
    expect(getRetirementStatus(null, NOW)).toEqual({ kind: 'none' });
  });

  it('is overdue after the expiry date', () => {
    expect(getRetirementStatus(at(-3), NOW)).toEqual({
      kind: 'overdue',
      daysOverdue: 3,
    });
    expect(isOverdue(flag('x', at(-3)), NOW)).toBe(true);
  });

  it('is expiring inside the 30-day window and silent beyond it', () => {
    expect(getRetirementStatus(at(10), NOW)).toEqual({
      kind: 'expiring',
      daysLeft: 10,
    });
    expect(getRetirementStatus(at(45), NOW)).toEqual({ kind: 'none' });
  });
});

describe('feature flag grouping', () => {
  it('reads the category from the kernel and sends unknown keys to Experimental', () => {
    const groups = groupFlags(
      [flag('blog_enabled'), flag('salon_staff_enabled'), flag('gone_flag')],
      NOW
    );
    expect(groups.UI.map(item => item.key)).toEqual(['blog_enabled']);
    expect(groups.Backend.map(item => item.key)).toEqual([
      'salon_staff_enabled',
    ]);
    expect(groups.Experimental.map(item => item.key)).toEqual(['gone_flag']);
  });

  it('orders a group: overdue, expiring, then by key', () => {
    const groups = groupFlags(
      [
        flag('c_flag'),
        flag('b_flag', at(5)),
        flag('a_flag'),
        flag('d_flag', at(-1)),
      ],
      NOW
    );
    expect(groups.Experimental.map(item => item.key)).toEqual([
      'd_flag',
      'b_flag',
      'a_flag',
      'c_flag',
    ]);
  });
});
