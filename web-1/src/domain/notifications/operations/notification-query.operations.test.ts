/**
 * Notification reads (notifications v2): the active-role scope and the wire shape.
 */
import { describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import {
  getRecentNotifications_IO,
  getUnreadNotificationsCount_IO,
} from './notification-query.operations';

describe('getRecentNotifications_IO', () => {
  it('returns ISO dates, newest first, and the unread count of the same scope', async () => {
    const findMany = vi.fn(async (..._args: unknown[]) => [
      {
        id: 'ntf_2',
        type: 'MESSAGE_RECEIVED',
        actor_name: null,
        target_path: '/app/messages/pair_1',
        created_at: new Date('2026-10-19T11:00:00Z'),
        read_at: null,
      },
    ]);
    const count = vi.fn(async (..._args: unknown[]) => 1);
    mockDb({ notification: { findMany, count } });
    const result = await getRecentNotifications_IO({
      userId: 'usr_1',
      accountType: 'STYLIST',
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.unread_count).toBe(1);
    expect(result.data.notifications[0]).toEqual({
      id: 'ntf_2',
      type: 'MESSAGE_RECEIVED',
      actor_name: null,
      target_path: '/app/messages/pair_1',
      created_at: '2026-10-19T11:00:00.000Z',
      read_at: null,
      announcement: null,
      activity_kind: null,
      session_id: null,
      change_scope: null,
      recipient_role: null,
    });
    const listArgs = findMany.mock.calls[0]?.[0] as {
      where: { user_id: string; OR: Array<{ recipient_role: string | null }> };
      orderBy: unknown;
      take: number;
    };
    expect(listArgs.where.OR).toEqual([
      { recipient_role: null },
      { recipient_role: 'STYLIST' },
    ]);
    expect(listArgs.orderBy).toEqual([{ created_at: 'desc' }, { id: 'desc' }]);
    expect(listArgs.take).toBe(50);
  });
});

describe('getUnreadNotificationsCount_IO', () => {
  it('counts unread rows of the active role plus role-less ones', async () => {
    const count = vi.fn(async (..._args: unknown[]) => 2);
    mockDb({ notification: { count } });
    const result = await getUnreadNotificationsCount_IO({
      userId: 'usr_1',
      accountType: 'CLIENT',
    });
    expect(result.success && result.data.unread_count).toBe(2);
    const where = (
      count.mock.calls[0]?.[0] as {
        where: { read_at: null; OR: Array<{ recipient_role: string | null }> };
      }
    ).where;
    expect(where.read_at).toBeNull();
    expect(where.OR).toEqual([
      { recipient_role: null },
      { recipient_role: 'CLIENT' },
    ]);
  });
});
