import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../src/prisma/js-client';
import type { AuthDb } from './auth-db.fixture';
import {
  createSessionActivityDb,
  sessionActivityFixture,
} from './session-activity.fixture';

const holder = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    get use() {
      if (!holder.client) {
        throw new Error('No test DB');
      }
      return holder.client;
    },
  },
}));
import { getConversations_IO } from '@domain/messaging/operations/messaging-query.operations';

const url = process.env.SESSION_ACTIVITY_TEST_DATABASE_URL;
describe.skipIf(!url)('whole-inbox unread totals on PostgreSQL', () => {
  let db: AuthDb;
  beforeAll(async () => {
    db = await createSessionActivityDb(url ?? '');
    holder.client = db.seeder;
  }, 120_000);
  afterAll(async () => {
    holder.client = null;
    await db?.drop();
  });

  it('counts all visible messages and conversations, scoped to each side and hidden mode', async () => {
    const a = await sessionActivityFixture(db);
    const foreign = await sessionActivityFixture(db);
    const base = new Date('2026-10-01T00:00:00.000Z');
    await db.seeder.clientStylistPair.update({
      where: { id: a.pairId },
      data: {
        last_message_at: new Date(base.getTime() + 4_000),
        client_last_read_at: base,
      },
    });
    await db.seeder.stylistClientMessage.createMany({
      data: [
        // This edit became unread after the watermark despite its older creation time.
        {
          pair_id: a.pairId,
          sender_type: 'STYLIST',
          content: 'session',
          kind: 'SESSION_CHANGED',
          session_id: a.sessionId,
          created_at: new Date(base.getTime() - 1_000),
          activity_at: new Date(base.getTime() + 2_000),
        },
        {
          pair_id: a.pairId,
          sender_type: 'STYLIST',
          content: 'another',
          activity_at: new Date(base.getTime() + 3_000),
        },
        {
          pair_id: a.pairId,
          sender_type: 'CLIENT',
          content: 'own',
          activity_at: new Date(base.getTime() + 4_000),
        },
      ],
    });
    for (let i = 0; i < 54; i++) {
      const key = `unread_stylist_${i}`;
      await db.seedUser(key, 'STYLIST');
      const pair = await db.seeder.clientStylistPair.create({
        data: {
          client_user_id: a.clientUserId,
          stylist_account_id: `sa_${key}`,
          status: i % 2 ? 'REVOKED' : 'CONTACT',
          last_message_at: new Date(base.getTime() + 10_000 + i),
          client_hidden_at: i === 51 ? base : null,
        },
      });
      await db.seeder.stylistClientMessage.create({
        data: {
          pair_id: pair.id,
          sender_type: 'STYLIST',
          content: 'hello',
          activity_at: new Date(base.getTime() + 10_000 + i),
        },
      });
      if (i === 52) {
        await db.seeder.user.update({
          where: { id: db.idOf(key) },
          data: { is_active: false },
        });
      }
      if (i === 53) {
        await db.seeder.stylistAccount.update({
          where: { account_id: `sa_${key}` },
          data: { account_status: 'NOT_ACTIVE' },
        });
      }
    }
    await db.seeder.clientStylistPair.update({
      where: { id: foreign.pairId },
      data: { last_message_at: base },
    });
    await db.seeder.stylistClientMessage.create({
      data: {
        pair_id: foreign.pairId,
        sender_type: 'STYLIST',
        content: 'foreign',
      },
    });
    const first = await getConversations_IO({ currentUser: a.client });
    expect(first.success).toBe(true);
    if (!first.success) {
      return;
    }
    expect(first.data.conversations).toHaveLength(50);
    expect(first.data.unread_count).toBe(53);
    expect(first.data.unread_conversation_count).toBe(52);
    expect(first.data.next_cursor).not.toBeNull();
    if (first.data.next_cursor === null) {
      throw new Error('expected next page');
    }
    const second = await getConversations_IO({
      currentUser: a.client,
      cursor: first.data.next_cursor,
    });
    expect(second.success && second.data.unread_count).toBe(53);
    const hidden = await getConversations_IO({
      currentUser: a.client,
      hidden: true,
    });
    expect(hidden.success && hidden.data.unread_count).toBe(1);
    expect(hidden.success && hidden.data.unread_conversation_count).toBe(1);

    // The stylist side counts only the client's message and ignores inactive clients.
    const inactive = await db.seeder.clientStylistPair.create({
      data: {
        client_user_id: foreign.clientUserId,
        stylist_account_id: a.stylistAccountId,
        last_message_at: base,
      },
    });
    await db.seeder.stylistClientMessage.create({
      data: {
        pair_id: inactive.id,
        sender_type: 'CLIENT',
        content: 'inactive',
      },
    });
    await db.seeder.user.update({
      where: { id: foreign.clientUserId },
      data: { is_active: false },
    });
    const stylist = await getConversations_IO({ currentUser: a.stylist });
    expect(stylist.success && stylist.data.unread_count).toBe(1);
    expect(stylist.success && stylist.data.unread_conversation_count).toBe(1);
  }, 120_000);
});
