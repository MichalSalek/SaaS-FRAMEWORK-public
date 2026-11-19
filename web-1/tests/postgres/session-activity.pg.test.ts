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
import { closeSessionContainer_IO } from '@domain/session-container/operations/session-container-lifecycle.operations';
import { addPhotoToSessionContainer_IO } from '@domain/session-container/operations/session-container-add-photo.operation';
import { shareSessionContainer_IO } from '@domain/session-container/operations/session-container-share.operation';
import { lockSessionActivityContext } from '@domain/session-container/session-activity.lock';
import {
  configureLockOrderAssertions,
  heldLocksOf,
  resetLockOrderTracking,
} from '@app/db/lock-order';

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
  beforeAll(async () => {
    db = await createSessionActivityDb(url ?? '');
    holder.client = db.seeder;
  }, 120_000);
  afterAll(async () => {
    holder.client = null;
    await db?.drop();
  });

  it('locks both User parents before the account, conversation and session on real PostgreSQL', async () => {
    const a = await fixture();
    configureLockOrderAssertions(true);
    resetLockOrderTracking();
    try {
      await db.seeder.$transaction(async tx => {
        await lockSessionActivityContext(tx, a.sessionId);
        const keys = [...heldLocksOf(tx).keys()];
        const accountIndex = keys.indexOf(
          `StylistAccount:${a.stylistAccountId}`
        );
        expect(keys.indexOf(`User:${a.clientUserId}`)).toBeGreaterThanOrEqual(
          0
        );
        expect(keys.indexOf(`User:${a.stylistUserId}`)).toBeGreaterThanOrEqual(
          0
        );
        expect(keys.indexOf(`User:${a.clientUserId}`)).toBeLessThan(
          accountIndex
        );
        expect(keys.indexOf(`User:${a.stylistUserId}`)).toBeLessThan(
          accountIndex
        );
        expect(keys.indexOf(`ClientStylistPair:${a.pairId}`)).toBeLessThan(
          keys.indexOf(`SessionContainer:${a.sessionId}`)
        );
      });
    } finally {
      configureLockOrderAssertions(false);
    }
  });

  it('serializes concurrent acceptance and retries with one event, one notification and one outbox item', async () => {
    const a = await fixture();
    const results = await Promise.all([accept(a), accept(a), accept(a)]);
    expect(results.every(result => result.success)).toBe(true);
    expect((await accept(a)).success).toBe(true);
    const session = await db.seeder.sessionContainer.findUniqueOrThrow({
      where: { id: a.sessionId },
    });
    expect(session.accepted_at).not.toBeNull();
    const messages = await db.seeder.stylistClientMessage.findMany({
      where: { session_id: a.sessionId, kind: 'SESSION_ACCEPTED' },
    });
    expect(messages).toHaveLength(1);
    expect(
      await db.seeder.notification.count({
        where: { session_id: a.sessionId, activity_kind: 'SESSION_ACCEPTED' },
      })
    ).toBe(1);
    expect(
      await db.seeder.sessionActivityOutbox.count({
        where: { session_id: a.sessionId, kind: 'SESSION_ACCEPTED' },
      })
    ).toBe(1);
  });

  it('commits photo, submit card, bell and one email intent; repeated photo and share add no duplicate', async () => {
    const a = await fixture();
    await db.seeder.sessionContainer.update({
      where: { id: a.sessionId },
      data: {
        lifecycle_state: 'DRAFT',
        shared_at: null,
        expires_at: null,
        client_note: 'private content',
      },
    });
    const photo = await db.seeder.galleryRecord.create({
      data: {
        created_by_account_id: a.stylistAccountId,
        asset_url: 'https://example.test/submit',
        nail_length: 'SHORT',
      },
    });
    const add = () =>
      addPhotoToSessionContainer_IO({
        client_user_id: a.clientUserId,
        client_account_id: a.clientAccountId,
        session_id: a.sessionId,
        gallery_record_id: photo.gallery_record_id,
      });
    expect((await add()).success).toBe(true);
    expect((await add()).success).toBe(true);
    expect(
      await db.seeder.sessionContainerPhoto.count({
        where: { session_id: a.sessionId },
      })
    ).toBe(1);
    expect(
      await db.seeder.stylistClientMessage.count({
        where: { session_id: a.sessionId },
      })
    ).toBe(0);
    const share = () =>
      shareSessionContainer_IO({
        client_user_id: a.clientUserId,
        client_account_id: a.clientAccountId,
        session_id: a.sessionId,
      });
    expect((await share()).success).toBe(true);
    expect((await share()).success).toBe(false);
    const message = await db.seeder.stylistClientMessage.findFirstOrThrow({
      where: { session_id: a.sessionId, kind: 'SESSION_SUBMITTED' },
    });
    expect(message.content).not.toContain('private content');
    expect(
      await db.seeder.notification.count({
        where: { session_id: a.sessionId, activity_kind: 'SESSION_SUBMITTED' },
      })
    ).toBe(1);
    expect(
      await db.seeder.sessionActivityOutbox.count({
        where: { session_id: a.sessionId, kind: 'SESSION_SUBMITTED' },
      })
    ).toBe(1);
    const email = await db.seeder.emailLifecycleMessage.findMany({
      where: {
        accountId: a.stylistAccountId,
        occurrence: a.sessionId,
        ruleId: 'session-shared',
      },
    });
    expect(email).toHaveLength(1);
    expect(email[0]).toMatchObject({
      outbox: true,
      status: 'reserved',
      userId: a.stylistUserId,
    });
    expect(JSON.stringify(email[0]?.outboxPayload)).not.toContain(
      'private content'
    );
    expect((await accept(a)).success).toBe(true);
    const second = await db.seeder.galleryRecord.create({
      data: {
        created_by_account_id: a.stylistAccountId,
        asset_url: 'https://example.test/second',
        nail_length: 'SHORT',
      },
    });
    const addSecond = () =>
      addPhotoToSessionContainer_IO({
        client_user_id: a.clientUserId,
        client_account_id: a.clientAccountId,
        session_id: a.sessionId,
        gallery_record_id: second.gallery_record_id,
      });
    expect((await addSecond()).success).toBe(true);
    expect((await addSecond()).success).toBe(true);
    const updates = await db.seeder.stylistClientMessage.findMany({
      where: { session_id: a.sessionId, kind: 'SESSION_CHANGED' },
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ revision: 1, change_scope: 'PHOTOS' });
  });

  it('rejects foreign, never-shared, expired, closed, revoked and inactive sessions without effects', async () => {
    const a = await fixture();
    const foreign = await acceptSessionContainer_IO({
      session_id: a.sessionId,
      stylist_account_id: 'foreign',
      user_id: 'foreign',
    });
    expect(foreign.success).toBe(false);
    for (const data of [
      { lifecycle_state: 'DRAFT' as const, shared_at: null },
      {
        lifecycle_state: 'SHARED' as const,
        shared_at: new Date(),
        expires_at: new Date(Date.now() - 1_000),
      },
      {
        lifecycle_state: 'CLOSED' as const,
        closed_at: new Date(),
        expires_at: new Date(Date.now() + 60_000),
      },
    ]) {
      await db.seeder.sessionContainer.update({
        where: { id: a.sessionId },
        data,
      });
      expect((await accept(a)).success).toBe(false);
    }
    await db.seeder.sessionContainer.update({
      where: { id: a.sessionId },
      data: {
        lifecycle_state: 'SHARED',
        shared_at: new Date(),
        closed_at: null,
        expires_at: new Date(Date.now() + 60_000),
      },
    });
    await db.seeder.clientStylistPair.update({
      where: { id: a.pairId },
      data: { status: 'REVOKED' },
    });
    expect((await accept(a)).success).toBe(false);
    await db.seeder.clientStylistPair.update({
      where: { id: a.pairId },
      data: { status: 'ACTIVE' },
    });
    await db.seeder.user.update({
      where: { id: a.clientUserId },
      data: { is_active: false },
    });
    expect((await accept(a)).success).toBe(false);
    expect(
      await db.seeder.stylistClientMessage.count({
        where: { session_id: a.sessionId },
      })
    ).toBe(0);
    expect(
      await db.seeder.sessionActivityOutbox.count({
        where: { session_id: a.sessionId },
      })
    ).toBe(0);
  });

  it('keeps an authorized accepted retry idempotent after close but denies revoked retry', async () => {
    const a = await fixture();
    expect((await accept(a)).success).toBe(true);
    expect(
      (
        await closeSessionContainer_IO({
          session_id: a.sessionId,
          user_id: a.clientUserId,
          client_account_id: a.clientAccountId,
          stylist_account_id: undefined,
        })
      ).success
    ).toBe(true);
    expect((await accept(a)).success).toBe(true);
    await db.seeder.clientStylistPair.update({
      where: { id: a.pairId },
      data: { status: 'REVOKED' },
    });
    expect((await accept(a)).success).toBe(false);
    expect(
      await db.seeder.stylistClientMessage.count({
        where: { session_id: a.sessionId, kind: 'SESSION_ACCEPTED' },
      })
    ).toBe(1);
  });
});
