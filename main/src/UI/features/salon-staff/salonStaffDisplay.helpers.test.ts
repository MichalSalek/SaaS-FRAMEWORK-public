import { describe, expect, it } from 'vitest';
import type { StaffMemberDTO } from '@kernel/models/salon-staff/salon-staff.dto';
import {
  formatJoinedMonth,
  getAvatarSrc,
  getDisplayName,
  isPendingInvite,
} from './salonStaffDisplay.helpers';

const INACTIVE_LABEL = 'Konto nieaktywne';

function makeMember(overrides: Partial<StaffMemberDTO> = {}): StaffMemberDTO {
  return {
    id: 'staff-1',
    stylist_account_id: 'salon-1',
    user_id: 'user-1',
    role: 'EMPLOYEE',
    is_active: true,
    permissions: [],
    created_at: '2026-01-01T00:00:00.000Z',
    user_inactive: false,
    accepted_at: '2026-01-02T00:00:00.000Z',
    user: {
      id: 'user-1',
      email: 'anna@example.com',
      image: null,
      name: 'Anna Nowak',
    },
    ...overrides,
  };
}

describe('getDisplayName', () => {
  it('returns the inactive label when user_inactive is true', () => {
    const member = makeMember({
      user_inactive: true,
      user: { id: 'user-1', email: '', image: null, name: null },
    });
    expect(getDisplayName(member, INACTIVE_LABEL)).toBe(INACTIVE_LABEL);
  });

  it('does not fall through to id when the inactive row is masked', () => {
    const member = makeMember({
      id: 'staff-secret',
      user_inactive: true,
      user: { id: 'user-1', email: '', image: null, name: null },
    });
    expect(getDisplayName(member, INACTIVE_LABEL)).not.toBe('staff-secret');
  });

  it('prefers user.name for an active member', () => {
    expect(getDisplayName(makeMember(), INACTIVE_LABEL)).toBe('Anna Nowak');
  });

  it('falls back to email when name is null', () => {
    const member = makeMember({
      user: {
        id: 'user-1',
        email: 'anna@example.com',
        image: null,
        name: null,
      },
    });
    expect(getDisplayName(member, INACTIVE_LABEL)).toBe('anna@example.com');
  });

  it('falls back to email when name is an empty string', () => {
    const member = makeMember({
      user: { id: 'user-1', email: 'anna@example.com', image: null, name: '' },
    });
    expect(getDisplayName(member, INACTIVE_LABEL)).toBe('anna@example.com');
  });

  it('falls back to member.id when name and email are missing', () => {
    const { user: _user, ...member } = makeMember();
    expect(getDisplayName(member, INACTIVE_LABEL)).toBe('staff-1');
  });
});

describe('isPendingInvite', () => {
  it('is true for an invitation that was not accepted yet', () => {
    expect(isPendingInvite(makeMember({ accepted_at: null }))).toBe(true);
  });

  it('is true for a pending invite even though its seat row is active', () => {
    // The membership row is created active at invitation time.
    expect(
      isPendingInvite(makeMember({ is_active: true, accepted_at: null }))
    ).toBe(true);
  });

  it('does not treat a dead-user seat as a pending invite', () => {
    expect(
      isPendingInvite(makeMember({ accepted_at: null, user_inactive: true }))
    ).toBe(false);
  });

  it('is false for an accepted member', () => {
    expect(isPendingInvite(makeMember())).toBe(false);
  });
});

describe('getAvatarSrc', () => {
  it('returns empty string for an inactive user (no photo, no id seed)', () => {
    const member = makeMember({
      user_inactive: true,
      user: { id: 'user-1', email: '', image: null, name: null },
    });
    expect(getAvatarSrc(member)).toBe('');
  });

  it('returns the user image when present', () => {
    const member = makeMember({
      user: {
        id: 'user-1',
        email: 'anna@example.com',
        image: 'https://cdn.example.com/anna.jpg',
        name: 'Anna Nowak',
      },
    });
    expect(getAvatarSrc(member)).toBe('https://cdn.example.com/anna.jpg');
  });
});

describe('formatJoinedMonth', () => {
  it('formats the acceptance month in the app locale', () => {
    expect(formatJoinedMonth('2026-09-15T10:00:00.000Z', 'en')).toBe(
      'Sep 2026'
    );
  });

  it('returns null for a pending invitation and for an invalid date', () => {
    expect(formatJoinedMonth(null, 'pl')).toBeNull();
    expect(formatJoinedMonth('not-a-date', 'pl')).toBeNull();
  });
});
