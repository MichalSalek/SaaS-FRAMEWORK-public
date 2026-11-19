import { describe, expect, it } from 'vitest';
import {
  resolveSalonInvitationsEntry,
  toDrawerInvitationsBadge,
} from './salonInvitationsEntry';

describe('resolveSalonInvitationsEntry', () => {
  it('is hidden while disabled, whatever the read says', () => {
    expect(
      resolveSalonInvitationsEntry({
        enabled: false,
        pendingCount: 2,
        isError: true,
      })
    ).toEqual({ kind: 'hidden' });
  });

  it('is hidden while the first read is still pending', () => {
    expect(
      resolveSalonInvitationsEntry({
        enabled: true,
        pendingCount: undefined,
        isError: false,
      })
    ).toEqual({ kind: 'hidden' });
  });

  it('is hidden after a successful read with nothing pending', () => {
    expect(
      resolveSalonInvitationsEntry({
        enabled: true,
        pendingCount: 0,
        isError: false,
      })
    ).toEqual({ kind: 'hidden' });
  });

  it('shows the count after a successful read', () => {
    expect(
      resolveSalonInvitationsEntry({
        enabled: true,
        pendingCount: 3,
        isError: false,
      })
    ).toEqual({ kind: 'count', count: 3 });
  });

  it('reports an error when the first read failed (not an empty inbox)', () => {
    expect(
      resolveSalonInvitationsEntry({
        enabled: true,
        pendingCount: undefined,
        isError: true,
      })
    ).toEqual({ kind: 'error' });
  });

  it('keeps the known count when only a background refetch failed', () => {
    expect(
      resolveSalonInvitationsEntry({
        enabled: true,
        pendingCount: 1,
        isError: true,
      })
    ).toEqual({ kind: 'count', count: 1 });
  });
});

describe('toDrawerInvitationsBadge', () => {
  it('maps count, error and hidden to the drawer contract', () => {
    expect(toDrawerInvitationsBadge({ kind: 'count', count: 2 })).toBe(2);
    expect(toDrawerInvitationsBadge({ kind: 'error' })).toBe(null);
    expect(toDrawerInvitationsBadge({ kind: 'hidden' })).toBe(0);
  });
});
