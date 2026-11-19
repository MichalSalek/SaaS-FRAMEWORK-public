/**
 * Notification write operations (notifications v2): the idempotency contract.
 * A repeated event is a silent no-op unless the caller asked to re-arm; marking
 * read stops at the newest row the screen saw; the Art. 17 scrub nulls the
 * name while the recipients keep their rows.
 */
import { describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import {
  createOrRearmNotification_IO,
  eraseActorFromNotifications_IO,
  markNotificationsRead_IO,
  markNotificationsReadByKeyPrefix_IO,
} from './notification-write.operations';

const row = {
  id: 'ntf_1',
  user_id: 'usr_stylist',
  recipient_role: 'STYLIST' as const,
  type: 'PAIR_REQUEST_RECEIVED' as const,
  dedup_key: 'PAIR_REQUEST_RECEIVED:pair_1',
  actor_user_id: 'usr_client',
  actor_name: 'Ola',
  target_path: '/app/clients',
  created_at: new Date('2026-10-19T10:00:00Z'),
  read_at: null,
};

const baseInput = {
  userId: 'usr_stylist',
  recipientRole: 'STYLIST' as const,
  type: 'PAIR_REQUEST_RECEIVED' as const,
  dedupKey: 'PAIR_REQUEST_RECEIVED:pair_1',
  actorUserId: 'usr_client',
  actorName: 'Ola',
  targetPath: '/app/clients',
};

describe('createOrRearmNotification_IO', () => {
  it('inserts once and reports created=true', async () => {
    const createMany = vi.fn(async (..._args: unknown[]) => ({ count: 1 }));
    mockDb({
      notification: { createMany, findUnique: async () => row },
    });
    const result = await createOrRearmNotification_IO({
      ...baseInput,
      rearm: false,
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.created).toBe(true);
    expect(result.data.notification.id).toBe('ntf_1');
    const args = createMany.mock.calls[0]?.[0] as {
      skipDuplicates: boolean;
      data: Array<{ dedup_key: string }>;
    };
    expect(args.skipDuplicates).toBe(true);
    expect(args.data[0]?.dedup_key).toBe('PAIR_REQUEST_RECEIVED:pair_1');
  });

  it('a repeated event without rearm is a silent no-op (created=false)', async () => {
    mockDb({
      notification: {
        createMany: async () => ({ count: 0 }),
        findUnique: async () => row,
      },
    });
    const result = await createOrRearmNotification_IO({
      ...baseInput,
      rearm: false,
    });
    expect(result.success && result.data.created).toBe(false);
  });

  it('rearm upserts: the existing row comes back unread and on top', async () => {
    const upsert = vi.fn(async (..._args: unknown[]) => ({
      ...row,
      read_at: null,
    }));
    mockDb({ notification: { upsert } });
    const result = await createOrRearmNotification_IO({
      ...baseInput,
      rearm: true,
    });
    expect(result.success && result.data.created).toBe(true);
    const args = upsert.mock.calls[0]?.[0] as {
      where: { user_id_dedup_key: { user_id: string; dedup_key: string } };
      update: { read_at: null; created_at: Date };
    };
    expect(args.where.user_id_dedup_key.dedup_key).toBe(
      'PAIR_REQUEST_RECEIVED:pair_1'
    );
    expect(args.update.read_at).toBeNull();
    expect(args.update.created_at).toBeInstanceOf(Date);
  });

  it('a DB failure becomes DATABASE_ERROR, never a throw', async () => {
    mockDb({
      notification: {
        createMany: async () => {
          throw new Error('boom');
        },
      },
    });
    const result = await createOrRearmNotification_IO({
      ...baseInput,
      rearm: false,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('DATABASE_ERROR');
    }
  });
});

describe('markNotificationsRead_IO', () => {
  it('marks only unread rows of the active role up to newest_seen_at', async () => {
    const updateMany = vi.fn(async (..._args: unknown[]) => ({ count: 3 }));
    mockDb({ notification: { updateMany } });
    const newestSeenAt = new Date('2026-10-19T12:00:00Z');
    const result = await markNotificationsRead_IO({
      userId: 'usr_1',
      accountType: 'CLIENT',
      newestSeenAt,
    });
    expect(result.success && result.data.marked).toBe(3);
    const where = (
      updateMany.mock.calls[0]?.[0] as {
        where: {
          user_id: string;
          read_at: null;
          created_at: { lte: Date };
          OR: Array<{ recipient_role: string | null }>;
        };
      }
    ).where;
    expect(where.user_id).toBe('usr_1');
    expect(where.read_at).toBeNull();
    expect(where.created_at.lte).toBe(newestSeenAt);
    expect(where.OR).toEqual([
      { recipient_role: null },
      { recipient_role: 'CLIENT' },
    ]);
  });
});

describe('markNotificationsReadByKeyPrefix_IO', () => {
  it('closes every unread row about the subject, scoped to the user', async () => {
    const updateMany = vi.fn(async (..._args: unknown[]) => ({ count: 1 }));
    mockDb({ notification: { updateMany } });
    await markNotificationsReadByKeyPrefix_IO({
      userId: 'usr_1',
      keyPrefix: 'MESSAGE_RECEIVED:pair_9',
    });
    const where = (
      updateMany.mock.calls[0]?.[0] as {
        where: { user_id: string; dedup_key: { startsWith: string } };
      }
    ).where;
    expect(where.user_id).toBe('usr_1');
    expect(where.dedup_key.startsWith).toBe('MESSAGE_RECEIVED:pair_9');
  });
});

describe('eraseActorFromNotifications_IO', () => {
  it('nulls the name and the soft reference in other people’s rows', async () => {
    const updateMany = vi.fn(async (..._args: unknown[]) => ({ count: 4 }));
    mockDb({ notification: { updateMany } });
    const result = await eraseActorFromNotifications_IO('usr_gone');
    expect(result.success && result.data.erased).toBe(4);
    const args = updateMany.mock.calls[0]?.[0] as {
      where: { actor_user_id: string };
      data: { actor_name: null; actor_user_id: null };
    };
    expect(args.where.actor_user_id).toBe('usr_gone');
    expect(args.data).toEqual({ actor_name: null, actor_user_id: null });
  });
});
