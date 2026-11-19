import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../src/prisma/js-client';
import type { AuthDb } from './auth-db.fixture';
import {
  sessionActivityFixture,
  createSessionActivityDb,
  type SessionActivityFixture,
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
vi.mock('@domain/visit/operations/visit-session-archive.operations', () => ({
  scheduleSessionVisitArchiveBestEffort: vi.fn(),
}));
import { acceptSessionContainer_IO } from '@domain/session-container/operations/session-container-accept.operation';
import {
  closeSessionContainer_IO,
  setSessionContainerNote_IO,
} from '@domain/session-container/operations/session-container-lifecycle.operations';
import { removePhotoFromSessionContainer_IO } from '@domain/session-container/operations/session-container-remove-photo.operation';
import { markRead_IO } from '@domain/messaging/operations/messaging-read.operations';
import { sendMessage_IO } from '@domain/messaging/operations/messaging-write.operations';
import { lockUserRow } from '@app/db/lock-rows';

const url = process.env.SESSION_ACTIVITY_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname) ||
    !/^\/nf_session_activity_[a-z0-9_]+$/.test(parsed.pathname)
  ) {
    throw new Error(
      'Session activity test requires a dedicated loopback nf_session_activity_* database'
    );
  }
}

describe.skipIf(!url)('session activity on real PostgreSQL', () => {
  let db: AuthDb;
  const fixture = () => sessionActivityFixture(db);
  const accept = (a: SessionActivityFixture) =>
    acceptSessionContainer_IO({
      session_id: a.sessionId,
      stylist_account_id: a.stylistAccountId,
      user_id: a.stylistUserId,
    });
  const note = (
    a: SessionActivityFixture,
    value: string,
    side: 'client' | 'stylist' = 'client'
  ) =>
    setSessionContainerNote_IO({
      session_id: a.sessionId,
      note: value,
      side,
      client_account_id: side === 'client' ? a.clientAccountId : undefined,
      stylist_account_id: side === 'stylist' ? a.stylistAccountId : undefined,
      user_id: side === 'client' ? a.clientUserId : a.stylistUserId,
    });
  beforeAll(async () => {
    db = await createSessionActivityDb(url ?? '');
    holder.client = db.seeder;
  }, 120_000);
  afterAll(async () => {
    holder.client = null;
    await db?.drop();
  });

  it('records first client edit after acceptance, merges photo and note, skips no-ops and private notes, and respects message and time boundaries', async () => {
    const a = await fixture();
    expect((await note(a, 'before acceptance')).success).toBe(true);
    expect(
      await db.seeder.stylistClientMessage.count({
        where: { session_id: a.sessionId },
      })
    ).toBe(0);
    expect((await accept(a)).success).toBe(true);
    const firstEdit = await note(a, 'first edit');
    expect(firstEdit.success).toBe(true);
    const changed = await db.seeder.stylistClientMessage.findFirstOrThrow({
      where: { session_id: a.sessionId, kind: 'SESSION_CHANGED' },
    });
    expect(changed).toMatchObject({ revision: 1, change_scope: 'NOTE' });
    if (!firstEdit.success) {
      throw new Error('Expected a successful client note edit');
    }
    expect(firstEdit.data.last_client_change_at).toEqual(
      changed.activity_at.toISOString()
    );
    expect((await note(a, 'first edit')).success).toBe(true);
    expect((await note(a, 'stylist private', 'stylist')).success).toBe(true);
    expect(
      await db.seeder.stylistClientMessage.findUniqueOrThrow({
        where: { id: changed.id },
      })
    ).toMatchObject({ revision: 1, change_scope: 'NOTE' });
    const photo = await db.seeder.galleryRecord.create({
      data: {
        created_by_account_id: a.stylistAccountId,
        asset_url: 'https://example.test/photo',
        nail_length: 'SHORT',
      },
    });
    await db.seeder.sessionContainerPhoto.create({
      data: {
        session_id: a.sessionId,
        gallery_record_id: photo.gallery_record_id,
      },
    });
    const remove = await removePhotoFromSessionContainer_IO({
      client_user_id: a.clientUserId,
      client_account_id: a.clientAccountId,
      session_id: a.sessionId,
      gallery_record_id: photo.gallery_record_id,
    });
    expect(remove.success).toBe(true);
    expect(
      await db.seeder.stylistClientMessage.findUniqueOrThrow({
        where: { id: changed.id },
      })
    ).toMatchObject({ revision: 2, change_scope: 'PHOTOS_AND_NOTE' });
    expect(
      await db.seeder.sessionActivityOutbox.count({
        where: { session_id: a.sessionId, kind: 'SESSION_CHANGED' },
      })
    ).toBe(1);
    expect(
      (
        await sendMessage_IO({
          currentUser: a.client,
          pairId: a.pairId,
          content: 'Text between updates',
        })
      ).success
    ).toBe(true);
    expect((await note(a, 'after message')).success).toBe(true);
    expect(
      await db.seeder.stylistClientMessage.count({
        where: { session_id: a.sessionId, kind: 'SESSION_CHANGED' },
      })
    ).toBe(2);
    const latest = await db.seeder.stylistClientMessage.findFirstOrThrow({
      where: { session_id: a.sessionId, kind: 'SESSION_CHANGED' },
      orderBy: { activity_at: 'desc' },
    });
    await db.seeder.stylistClientMessage.update({
      where: { id: latest.id },
      data: { created_at: new Date(Date.now() - 121_000) },
    });
    expect((await note(a, 'outside window')).success).toBe(true);
    expect(
      await db.seeder.stylistClientMessage.count({
        where: { session_id: a.sessionId, kind: 'SESSION_CHANGED' },
      })
    ).toBe(3);
  });

  it('keeps read watermark monotonic, caps it to actual activity and marks a later grouped revision unread', async () => {
    const a = await fixture();
    expect((await accept(a)).success).toBe(true);
    expect((await note(a, 'first')).success).toBe(true);
    const first = await db.seeder.stylistClientMessage.findFirstOrThrow({
      where: { session_id: a.sessionId, kind: 'SESSION_CHANGED' },
    });
    expect(
      (
        await markRead_IO({
          currentUser: a.stylist,
          pairId: a.pairId,
          readThrough: first.activity_at,
        })
      ).success
    ).toBe(true);
    expect(
      (
        await markRead_IO({
          currentUser: a.stylist,
          pairId: a.pairId,
          readThrough: new Date(0),
        })
      ).success
    ).toBe(true);
    let pair = await db.seeder.clientStylistPair.findUniqueOrThrow({
      where: { id: a.pairId },
    });
    expect(pair.stylist_last_read_at?.getTime()).toBe(
      first.activity_at.getTime()
    );
    expect((await note(a, 'second')).success).toBe(true);
    const revised = await db.seeder.stylistClientMessage.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(revised.revision).toBe(2);
    expect(revised.activity_at.getTime()).toBeGreaterThan(
      first.activity_at.getTime()
    );
    pair = await db.seeder.clientStylistPair.findUniqueOrThrow({
      where: { id: a.pairId },
    });
    expect(revised.activity_at.getTime()).toBeGreaterThan(
      pair.stylist_last_read_at?.getTime() ?? 0
    );
    expect(
      (
        await markRead_IO({
          currentUser: a.stylist,
          pairId: a.pairId,
          readThrough: new Date(Date.now() + 86_400_000),
        })
      ).success
    ).toBe(true);
    pair = await db.seeder.clientStylistPair.findUniqueOrThrow({
      where: { id: a.pairId },
    });
    expect(pair.stylist_last_read_at?.getTime()).toBe(
      pair.last_message_at?.getTime()
    );
  });

  it('does not write an edit or activity if closure commits while the edit is waiting for the user lock', async () => {
    const a = await fixture();
    expect((await accept(a)).success).toBe(true);
    const client = db.makeClient().client;
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    const acquired = new Promise<void>(resolve => {
      entered = resolve;
    });
    const holderTx = client.$transaction(
      async tx => {
        await lockUserRow(tx, a.clientUserId);
        entered();
        await held;
      },
      { timeout: 15_000 }
    );
    await acquired;
    const waitForBlocked = async (expected: bigint) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = await db.seeder.$queryRaw<
          Array<{ count: bigint }>
        >`SELECT COUNT(*) AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FROM "users"%'`;
        if ((rows[0]?.count ?? 0n) >= expected) {
          return true;
        }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return false;
    };
    const close = closeSessionContainer_IO({
      session_id: a.sessionId,
      user_id: a.clientUserId,
      client_account_id: a.clientAccountId,
      stylist_account_id: undefined,
    });
    let edit: ReturnType<typeof note> | undefined;
    try {
      expect(await waitForBlocked(1n)).toBe(true);
      edit = note(a, 'must not land after closure');
      expect(await waitForBlocked(2n)).toBe(true);
    } finally {
      release();
    }
    await holderTx;
    expect((await close).success).toBe(true);
    expect(edit).toBeDefined();
    expect((await edit)?.success).toBe(false);
    const session = await db.seeder.sessionContainer.findUniqueOrThrow({
      where: { id: a.sessionId },
    });
    expect(session.lifecycle_state).toBe('CLOSED');
    expect(session.client_note).toBeNull();
    expect(
      await db.seeder.stylistClientMessage.count({
        where: { session_id: a.sessionId, kind: 'SESSION_CHANGED' },
      })
    ).toBe(0);
  });
});
