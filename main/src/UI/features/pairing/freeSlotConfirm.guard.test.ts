import { describe, expect, it, vi } from 'vitest';
import { beginFreeSlotConfirm } from './freeSlotConfirm.guard';

describe('beginFreeSlotConfirm', () => {
  it('blocks a second confirm while the revoke is in flight', () => {
    const revoke = vi.fn();

    expect(beginFreeSlotConfirm({ isPending: true, revoke })).toBe('blocked');
    expect(revoke).not.toHaveBeenCalled();
  });

  it('starts the revoke when idle', () => {
    const revoke = vi.fn();

    expect(beginFreeSlotConfirm({ isPending: false, revoke })).toBe('started');
    expect(revoke).toHaveBeenCalledTimes(1);
  });
});
