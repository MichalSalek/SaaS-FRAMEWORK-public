import { beforeEach, describe, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: { use: { eventLog: { findMany: io.findMany } } },
}));
import { getEmailHistory_IO } from './email-query.operations';
import { FREE_EMAIL_RULES } from '@kernel/domain/email/email-free.config';
const at = new Date('2026-10-20T12:00:00Z');
describe('Free accepted-send history compatibility', () => {
  beforeEach(() => vi.clearAllMocks());
  it('maps all Free templates to the existing sequence category', async () => {
    const rows = Object.values(FREE_EMAIL_RULES).map((rule, index) => ({
      event_log_id: `free-${index}`,
      event: rule.infoEvent,
      created_at: at,
    }));
    io.findMany.mockResolvedValue(rows);
    const result = await getEmailHistory_IO('owner');
    expect(result).toEqual({
      success: true,
      data: {
        emails: rows.map(row => ({
          event_log_id: row.event_log_id,
          event: row.event,
          sentAt: at.toISOString(),
          category: 'TRIAL_SEQUENCE',
        })),
        nextCursor: null,
      },
    });
  });
  it('keeps a single cursor dataset and filters controls before pagination', async () => {
    io.findMany.mockResolvedValue([
      {
        event_log_id: 'c000000000000000000000002',
        event: 'EMAIL_FREE_FIRST_PHOTO_SENT',
        created_at: at,
      },
      {
        event_log_id: 'c000000000000000000000001',
        event: 'EMAIL_TRIAL_D1_NUDGE_SENT',
        created_at: at,
      },
    ]);
    const result = await getEmailHistory_IO('owner', { take: 1 });
    expect(result.success && result.data.nextCursor).toBe(
      'c000000000000000000000002'
    );
    expect(io.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          created_by_user_id: 'owner',
          event: {
            notIn: expect.arrayContaining([
              'EMAIL_SWEEP_COMPLETED',
              'EMAIL_PREFERENCES_UPDATED',
            ]),
          },
        }),
        take: 2,
        orderBy: { event_log_id: 'desc' },
      })
    );
    io.findMany.mockResolvedValue([]);
    await getEmailHistory_IO('owner', {
      take: 1,
      cursor: 'c000000000000000000000002',
    });
    expect(io.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cursor: { event_log_id: 'c000000000000000000000002' },
        skip: 1,
      })
    );
  });
});
