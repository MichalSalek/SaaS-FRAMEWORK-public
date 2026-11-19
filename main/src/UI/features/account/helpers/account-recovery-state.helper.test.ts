import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIME } from '@kernel/application/constants.config';
import { RECOVERY_CONFIG } from '@kernel/domain/recovery/deleted-user-backup.types';
import { getRecoveryDaysLeft } from './account-recovery-state.helper';

describe('recovery countdown display', () => {
  const now = Date.UTC(2026, 10, 8, 12);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });
  afterEach(() => vi.useRealTimers());

  it.each([1, TIME.MS_PER_DAY])(
    'does not promise extra days when the browser clock is behind by %i ms',
    skew => {
      expect(getRecoveryDaysLeft(new Date(now + skew).toISOString())).toBe(
        RECOVERY_CONFIG.MAX_DAYS
      );
    }
  );

  it('keeps the real countdown and the elapsed-window lower bound', () => {
    expect(getRecoveryDaysLeft(new Date(now).toISOString())).toBe(
      RECOVERY_CONFIG.MAX_DAYS
    );
    expect(
      getRecoveryDaysLeft(new Date(now - TIME.MS_PER_DAY).toISOString())
    ).toBe(RECOVERY_CONFIG.MAX_DAYS - 1);
    expect(
      getRecoveryDaysLeft(
        new Date(
          now - (RECOVERY_CONFIG.MAX_DAYS + 1) * TIME.MS_PER_DAY
        ).toISOString()
      )
    ).toBe(0);
  });

  it('does not manufacture a deadline for missing or invalid timestamps', () => {
    expect(getRecoveryDaysLeft(null)).toBeNull();
    expect(getRecoveryDaysLeft(undefined)).toBeNull();
    expect(getRecoveryDaysLeft('not-a-date')).toBeNull();
  });
});
