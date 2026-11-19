import { describe, expect, it } from 'vitest';
import type { StaffInvitationDTO } from '@kernel/models/salon-staff/salon-staff.dto';
import {
  buildInvitationRows,
  formatInvitedAgo,
  resolveInvitationHeading,
} from './salonInvitations.helpers';

function makeInvitation(
  overrides: Partial<StaffInvitationDTO> = {}
): StaffInvitationDTO {
  return {
    staff_member_id: 'staff-1',
    salon_account_id: 'salon-1',
    inviter_name: 'Anna Kowalska',
    salon_name: 'Studio Anna',
    owner_avatar_url: null,
    role: 'EMPLOYEE',
    invited_at: '2026-09-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('resolveInvitationHeading', () => {
  it('shows the inviter name with the salon name under it', () => {
    expect(resolveInvitationHeading(makeInvitation())).toEqual({
      title: 'Anna Kowalska',
      subtitle: 'Studio Anna',
    });
  });

  it('does not repeat the salon name when it is the title', () => {
    expect(
      resolveInvitationHeading(
        makeInvitation({
          inviter_name: 'Studio Anna',
          salon_name: 'Studio Anna',
        })
      )
    ).toEqual({ title: 'Studio Anna', subtitle: null });
  });

  it('falls back to the salon name when the inviter name is empty', () => {
    expect(
      resolveInvitationHeading(makeInvitation({ inviter_name: '  ' }))
    ).toEqual({ title: 'Studio Anna', subtitle: null });
  });

  it('returns no title when neither name is set', () => {
    expect(
      resolveInvitationHeading(
        makeInvitation({ inviter_name: '', salon_name: null })
      )
    ).toEqual({ title: null, subtitle: null });
  });
});

describe('formatInvitedAgo', () => {
  const now = new Date('2026-09-25T12:00:00.000Z');

  it('says today for an invitation from the last 24 hours', () => {
    expect(formatInvitedAgo('2026-09-25T08:00:00.000Z', now, 'en')).toBe(
      'today'
    );
  });

  it('says yesterday in Polish', () => {
    expect(formatInvitedAgo('2026-09-24T08:00:00.000Z', now, 'pl')).toBe(
      'wczoraj'
    );
  });

  it('counts days under a week', () => {
    expect(formatInvitedAgo('2026-09-22T08:00:00.000Z', now, 'en')).toBe(
      '3 days ago'
    );
  });

  it('counts weeks from seven days on', () => {
    expect(formatInvitedAgo('2026-09-11T08:00:00.000Z', now, 'en')).toBe(
      '2 weeks ago'
    );
  });

  it('switches to a calendar date from 30 days on', () => {
    const label = formatInvitedAgo('2026-07-01T08:00:00.000Z', now, 'en');
    expect(label).not.toMatch(/ago/);
    expect(label).toMatch(/2026/);
  });

  it('never reads a clock skew as the future', () => {
    expect(formatInvitedAgo('2026-09-25T13:00:00.000Z', now, 'en')).toBe(
      'today'
    );
  });

  it('returns an empty label for an unparseable date', () => {
    expect(formatInvitedAgo('not-a-date', now, 'en')).toBe('');
  });
});

describe('buildInvitationRows', () => {
  const older = makeInvitation({
    staff_member_id: 'a',
    invited_at: '2026-09-01T00:00:00.000Z',
  });
  const newer = makeInvitation({
    staff_member_id: 'b',
    invited_at: '2026-09-10T00:00:00.000Z',
  });

  it('lists pending invitations oldest first', () => {
    const rows = buildInvitationRows({
      pending: [newer, older],
      resolved: {},
      failed: null,
      isRefreshing: false,
    });
    expect(rows.map(r => [r.kind, r.invitation.staff_member_id])).toEqual([
      ['pending', 'a'],
      ['pending', 'b'],
    ]);
  });

  it('keeps an answered invitation in place after it left the server list', () => {
    const rows = buildInvitationRows({
      pending: [newer],
      resolved: { a: { invitation: older, status: 'ACCEPTED' } },
      failed: null,
      isRefreshing: false,
    });
    expect(rows[0]).toEqual({
      kind: 'resolved',
      invitation: older,
      status: 'ACCEPTED',
    });
    expect(rows[1]?.kind).toBe('pending');
  });

  it('shows the confirmation before the refetch drops the invitation', () => {
    const rows = buildInvitationRows({
      pending: [older],
      resolved: { a: { invitation: older, status: 'DECLINED' } },
      failed: null,
      isRefreshing: true,
    });
    expect(rows).toEqual([
      { kind: 'resolved', invitation: older, status: 'DECLINED' },
    ]);
  });

  it('marks the card that failed while the invitation still exists', () => {
    const rows = buildInvitationRows({
      pending: [older, newer],
      resolved: {},
      failed: { invitation: newer, response: 'ACCEPT' },
      isRefreshing: false,
    });
    expect(rows.map(r => r.kind === 'pending' && r.hasError)).toEqual([
      false,
      true,
    ]);
  });

  it('says an invitation is gone once the refetch no longer returns it', () => {
    const rows = buildInvitationRows({
      pending: [],
      resolved: {},
      failed: { invitation: older, response: 'ACCEPT' },
      isRefreshing: false,
    });
    expect(rows).toEqual([{ kind: 'gone', invitation: older }]);
  });

  it('keeps the failed card while that refetch is still in flight', () => {
    const rows = buildInvitationRows({
      pending: [],
      resolved: {},
      failed: { invitation: older, response: 'DECLINE' },
      isRefreshing: true,
    });
    expect(rows).toEqual([
      { kind: 'pending', invitation: older, hasError: true },
    ]);
  });

  it('returns no rows when nothing is pending or answered', () => {
    expect(
      buildInvitationRows({
        pending: [],
        resolved: {},
        failed: null,
        isRefreshing: false,
      })
    ).toEqual([]);
  });
});
