import { describe, expect, it, vi } from 'vitest';
import { __setDb } from '../../../test-utils/setup';

const attach = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../salon-invitation-token.service', () => ({
  attachAcceptedSalonInvitations_IO: attach,
}));
import { respondToStaffInvitation_IO } from './salon-staff-invitation.operations';

describe('email invitation response races', () => {
  it('does not report acceptance after a concurrent decline wins', async () => {
    attach.mockClear();
    __setDb({
      user: { findUnique: vi.fn(async () => ({ email: 'a@example.test' })) },
      salonInvitation: {
        findFirst: vi.fn(async () => ({
          id: 'invite',
          salon_account_id: 'salon',
          accepted_at: null,
        })),
        updateMany: vi.fn(async () => ({ count: 0 })),
        findUnique: vi.fn(async () => ({
          accepted_at: null,
          declined_at: new Date(),
        })),
      },
    });
    const result = await respondToStaffInvitation_IO({
      userId: 'user',
      staffMemberId: 'invite',
      response: 'ACCEPT',
    });
    expect(result).toMatchObject({
      success: false,
      error: { type: 'SALON_STAFF_NOT_FOUND' },
    });
    expect(attach).not.toHaveBeenCalled();
  });
  it.each([0, 1])(
    'reports the committed acceptance and applied=%s after a replay',
    async count => {
      const firstDate = new Date('2026-11-07T08:00:00Z');
      __setDb({
        user: { findUnique: vi.fn(async () => ({ email: 'a@example.test' })) },
        salonInvitation: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({
              id: 'invite',
              salon_account_id: 'salon',
              accepted_at: null,
            })
            .mockResolvedValueOnce({ accepted_at: firstDate }),
          updateMany: vi.fn(async () => ({ count })),
        },
      });
      const result = await respondToStaffInvitation_IO({
        userId: 'user',
        staffMemberId: 'invite',
        response: 'ACCEPT',
      });
      expect(result).toMatchObject({
        success: true,
        data: { accepted_at: firstDate.toISOString(), applied: count === 1 },
      });
    }
  );
});
