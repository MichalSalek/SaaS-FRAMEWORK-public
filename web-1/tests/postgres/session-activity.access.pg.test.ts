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
import { sendMessage_IO } from '@domain/messaging/operations/messaging-write.operations';
import {
  getMySessionContainers_IO,
  getSessionContainerById_IO,
} from '@domain/session-container/operations/session-container-queries.operations';
import { getThread_IO } from '@domain/messaging/operations/messaging-query.operations';
import { getClientContactForStylist_IO } from '@domain/client/operations/client-profile.operations';
import { getClientCrmNote_IO } from '@domain/client/operations/client-crm-note.operations';
import { getPrivateNotes_IO } from '@domain/private-notes/operations/private-notes-query.operations';
import { getClientImportantNote_IO } from '@domain/client/operations/client-important-note.operations';
import { requireActivePairing_IO } from '@domain/visit/operations/visit-common.operations';
import {
  endContact_IO,
  openContact_IO,
} from '@domain/messaging/operations/messaging-contact.operations';

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

  it('denies acceptance on a derived pair after salon access has ended', async () => {
    const a = await fixture();
    await db.seeder.clientStylistPair.update({
      where: { id: a.pairId },
      data: {
        salon_origin_account_id: a.stylistAccountId,
        crm_note: 'private CRM',
        important_note: 'private important note',
      },
    });
    const detail = await getSessionContainerById_IO({
      session_id: a.sessionId,
      user_id: a.stylistUserId,
      stylist_account_id: a.stylistAccountId,
      client_account_id: undefined,
    });
    expect(detail.success && detail.data.can_accept).toBe(false);
    expect((await accept(a)).success).toBe(false);
    const ids = {
      client_user_id: a.clientUserId,
      stylist_account_id: a.stylistAccountId,
    };
    expect(
      (
        await getClientContactForStylist_IO({
          client_user_id: a.clientUserId,
          stylist_user_id: a.stylistUserId,
        })
      ).success
    ).toBe(false);
    expect(
      (await getClientCrmNote_IO({ ...ids, stylist_pricing_plan: 'PRO' }))
        .success
    ).toBe(false);
    expect((await getClientImportantNote_IO(ids)).success).toBe(false);
    expect((await requireActivePairing_IO(ids)).success).toBe(false);
    expect(
      (
        await db.seeder.sessionContainer.findUniqueOrThrow({
          where: { id: a.sessionId },
        })
      ).accepted_at
    ).toBeNull();
    expect(
      await db.seeder.stylistClientMessage.count({
        where: { session_id: a.sessionId, kind: 'SESSION_ACCEPTED' },
      })
    ).toBe(0);
  });

  it('blocks a CONTACT message when the stylist user is inactive despite an active account row', async () => {
    const a = await fixture();
    await db.seeder.clientStylistPair.update({
      where: { id: a.pairId },
      data: { status: 'CONTACT' },
    });
    await db.seeder.user.update({
      where: { id: a.stylistUserId },
      data: { is_active: false },
    });
    const result = await sendMessage_IO({
      currentUser: a.client,
      pairId: a.pairId,
      content: 'QA inactive recipient',
    });
    expect(result.success).toBe(false);
    expect(
      await db.seeder.stylistClientMessage.count({
        where: { pair_id: a.pairId },
      })
    ).toBe(0);
  });

  it('rejects a cached client context after the client user becomes inactive', async () => {
    const a = await fixture();
    await db.seeder.clientStylistPair.update({
      where: { id: a.pairId },
      data: { status: 'CONTACT' },
    });
    await db.seeder.user.update({
      where: { id: a.clientUserId },
      data: { is_active: false },
    });
    const result = await sendMessage_IO({
      currentUser: a.client,
      pairId: a.pairId,
      content: 'QA stale actor context',
    });
    expect(result.success).toBe(false);
    expect(
      await db.seeder.stylistClientMessage.count({
        where: { pair_id: a.pairId },
      })
    ).toBe(0);
  });

  it('allows CONTACT messaging but blocks session acceptance and prevents a stylist-revoked contact from reopening', async () => {
    const a = await fixture();
    await db.seeder.clientStylistPair.update({
      where: { id: a.pairId },
      data: { status: 'CONTACT' },
    });
    expect(
      (
        await sendMessage_IO({
          currentUser: a.client,
          pairId: a.pairId,
          content: 'Hello',
        })
      ).success
    ).toBe(true);
    expect((await accept(a)).success).toBe(false);
    expect(
      (await endContact_IO({ currentUser: a.stylist, pairId: a.pairId }))
        .success
    ).toBe(true);
    expect(
      (
        await openContact_IO({
          currentUser: a.client,
          stylistAccountId: a.stylistAccountId,
        })
      ).success
    ).toBe(false);
    expect(
      await db.seeder.stylistClientMessage.count({
        where: { pair_id: a.pairId, kind: 'TEXT' },
      })
    ).toBe(1);
    expect(
      (
        await sendMessage_IO({
          currentUser: a.client,
          pairId: a.pairId,
          content: 'No write after revoke',
        })
      ).success
    ).toBe(false);
  });

  it('does not grant a CONTACT stylist session, client contact or CRM access', async () => {
    const a = await fixture();
    await db.seeder.sessionContainer.update({
      where: { id: a.sessionId },
      data: { client_note: 'private inspiration' },
    });
    await db.seeder.clientStylistPair.update({
      where: { id: a.pairId },
      data: { status: 'CONTACT', crm_note: 'private CRM' },
    });
    const session = await getSessionContainerById_IO({
      session_id: a.sessionId,
      user_id: a.stylistUserId,
      stylist_account_id: a.stylistAccountId,
      client_account_id: undefined,
    });
    const contact = await getClientContactForStylist_IO({
      client_user_id: a.clientUserId,
      stylist_user_id: a.stylistUserId,
    });
    const crm = await getClientCrmNote_IO({
      client_user_id: a.clientUserId,
      stylist_account_id: a.stylistAccountId,
      stylist_pricing_plan: 'STUDIO',
    });
    expect(contact.success).toBe(false);
    expect(crm.success).toBe(false);
    expect(session.success).toBe(false);
  });

  it('hides CONTACT session notes in the notes hub, including the client filter', async () => {
    const a = await fixture();
    await db.seeder.sessionContainer.update({
      where: { id: a.sessionId },
      data: { client_note: 'private inspiration' },
    });
    await db.seeder.clientStylistPair.update({
      where: { id: a.pairId },
      data: { status: 'CONTACT' },
    });
    for (const clientUserId of [undefined, a.clientUserId]) {
      const result = await getPrivateNotes_IO({
        stylist_account_id: a.stylistAccountId,
        stylist_pricing_plan: 'PRO',
        client_user_id: clientUserId,
      });
      expect(result.success && result.data.session_notes).toEqual([]);
      expect(result.success && result.data.clients).toEqual([]);
    }
    await db.seeder.clientStylistPair.update({
      where: { id: a.pairId },
      data: { status: 'REVOKED' },
    });
    const archive = await getPrivateNotes_IO({
      stylist_account_id: a.stylistAccountId,
      stylist_pricing_plan: 'PRO',
    });
    expect(archive.success && archive.data.session_notes).toEqual([
      expect.objectContaining({ note: 'private inspiration' }),
    ]);
  });

  it('masks CONTACT session preview and list but keeps a revoked shared archive readable', async () => {
    const a = await fixture();
    const photo = await db.seeder.galleryRecord.create({
      data: {
        created_by_account_id: a.stylistAccountId,
        asset_url: 'https://example.test/private-photo',
        nail_length: 'SHORT',
      },
    });
    await db.seeder.sessionContainerPhoto.create({
      data: {
        session_id: a.sessionId,
        gallery_record_id: photo.gallery_record_id,
      },
    });
    expect((await accept(a)).success).toBe(true);
    await db.seeder.clientStylistPair.update({
      where: { id: a.pairId },
      data: { status: 'CONTACT' },
    });
    const list = () =>
      getMySessionContainers_IO({
        client_account_id: undefined,
        stylist_account_id: a.stylistAccountId,
      });
    const detail = () =>
      getSessionContainerById_IO({
        session_id: a.sessionId,
        client_account_id: undefined,
        stylist_account_id: a.stylistAccountId,
        user_id: a.stylistUserId,
      });
    const currentList = await list();
    expect(currentList.success && currentList.data.sessions).toEqual([]);
    expect(
      (
        await getMySessionContainers_IO({
          client_account_id: undefined,
          stylist_account_id: a.stylistAccountId,
          cursor: a.sessionId,
        })
      ).success
    ).toBe(false);
    const hidden = await getThread_IO({
      currentUser: a.stylist,
      pairId: a.pairId,
    });
    expect(hidden.success).toBe(true);
    if (!hidden.success) {
      throw new Error('Missing contact thread');
    }
    expect(
      hidden.data.messages.find(message => message.kind === 'SESSION_ACCEPTED')
    ).toMatchObject({ session_id: null, session_preview: null });
    expect((await detail()).success).toBe(false);
    await db.seeder.clientStylistPair.update({
      where: { id: a.pairId },
      data: { status: 'REVOKED' },
    });
    expect((await detail()).success).toBe(true);
    const archiveList = await list();
    expect(
      archiveList.success &&
        archiveList.data.sessions.some(session => session.id === a.sessionId)
    ).toBe(true);
    const archive = await getThread_IO({
      currentUser: a.stylist,
      pairId: a.pairId,
    });
    expect(archive.success).toBe(true);
    if (!archive.success) {
      throw new Error('Missing archived thread');
    }
    expect(
      archive.data.messages.find(message => message.kind === 'SESSION_ACCEPTED')
    ).toMatchObject({
      session_id: a.sessionId,
      session_preview: {
        thumbnails: ['https://example.test/private-photo'],
        remaining_count: 0,
      },
    });
  });
});
