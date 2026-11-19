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
import { duplicateSessionContainer_IO } from '@domain/session-container/operations/session-container-duplicate.operation';

const url = process.env.SESSION_ACTIVITY_TEST_DATABASE_URL;
describe.skipIf(!url)('session duplication on PostgreSQL', () => {
  let db: AuthDb;
  beforeAll(async () => {
    db = await createSessionActivityDb(url ?? '');
    holder.client = db.seeder;
    await db.seeder.$executeRawUnsafe(
      "CREATE UNIQUE INDEX session_container_active_pair_uq ON \"SessionContainer\" (client_account_id, stylist_account_id) WHERE lifecycle_state NOT IN ('CLOSED', 'EXPIRED') AND stylist_account_id IS NOT NULL"
    );
  }, 120_000);
  afterAll(async () => {
    holder.client = null;
    await db?.drop();
  });
  async function setup() {
    const a = await sessionActivityFixture(db);
    await db.seeder.sessionContainer.update({
      where: { id: a.sessionId },
      data: { lifecycle_state: 'CLOSED', client_note: 'source note' },
    });
    const photo = await db.seeder.galleryRecord.create({
      data: {
        created_by_account_id: a.stylistAccountId,
        asset_url: 'https://example.test/duplicate',
        nail_length: 'SHORT',
      },
    });
    await db.seeder.sessionContainerPhoto.create({
      data: {
        session_id: a.sessionId,
        gallery_record_id: photo.gallery_record_id,
        position: 0,
      },
    });
    const duplicate = () =>
      duplicateSessionContainer_IO({
        client_user_id: a.clientUserId,
        client_account_id: a.clientAccountId,
        session_id: a.sessionId,
      });
    return { ...a, photo, duplicate };
  }
  it.each(['DRAFT', 'READY', 'SHARED', 'ACTIVE'] as const)(
    'refuses existing %s without touching it',
    async state => {
      const a = await setup();
      const open = await db.seeder.sessionContainer.create({
        data: {
          client_account_id: a.clientAccountId,
          stylist_account_id: a.stylistAccountId,
          lifecycle_state: state,
          client_note: 'keep',
        },
      });
      const result = await a.duplicate();
      expect(result).toMatchObject({
        success: false,
        error: {
          type: 'SESSION_CONTAINER_PAIR_SESSION_EXISTS',
          existingSessionId: open.id,
        },
      });
      expect(
        await db.seeder.sessionContainer.findUniqueOrThrow({
          where: { id: open.id },
        })
      ).toMatchObject({ client_note: 'keep', lifecycle_state: state });
      expect(
        await db.seeder.sessionContainerPhoto.count({
          where: { session_id: open.id },
        })
      ).toBe(0);
    }
  );
  it('creates one ordered copy and skips a hidden photo', async () => {
    const a = await setup();
    const hidden = await db.seeder.galleryRecord.create({
      data: {
        created_by_account_id: a.stylistAccountId,
        asset_url: 'https://example.test/hidden',
        nail_length: 'SHORT',
        is_hidden: true,
      },
    });
    await db.seeder.sessionContainerPhoto.create({
      data: {
        session_id: a.sessionId,
        gallery_record_id: hidden.gallery_record_id,
        position: 1,
      },
    });
    const result = await a.duplicate();
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data).toMatchObject({
      clientNote: 'source note',
      lifecycleState: 'READY',
      photoCount: 1,
    });
    expect(result.data.photos.map(p => p.galleryRecordId)).toEqual([
      a.photo.gallery_record_id,
    ]);
  });
  it('refuses a photo from an unrelated stylist without creating a partial copy', async () => {
    const a = await setup();
    const other = await sessionActivityFixture(db);
    const foreign = await db.seeder.galleryRecord.create({
      data: {
        created_by_account_id: other.stylistAccountId,
        asset_url: 'https://example.test/foreign',
        nail_length: 'SHORT',
      },
    });
    await db.seeder.sessionContainerPhoto.create({
      data: {
        session_id: a.sessionId,
        gallery_record_id: foreign.gallery_record_id,
        position: 1,
      },
    });
    expect(await a.duplicate()).toMatchObject({
      success: false,
      error: { type: 'SESSION_CONTAINER_PHOTO_OWNERSHIP' },
    });
    expect(
      await db.seeder.sessionContainer.count({
        where: { client_account_id: a.clientAccountId },
      })
    ).toBe(1);
  });
  it('refuses revoked pairing without creating a copy', async () => {
    const a = await setup();
    await db.seeder.clientStylistPair.update({
      where: { id: a.pairId },
      data: { status: 'REVOKED' },
    });
    expect(await a.duplicate()).toMatchObject({
      success: false,
      error: { type: 'SESSION_CONTAINER_NOT_PAIRED' },
    });
    expect(
      await db.seeder.sessionContainer.count({
        where: { client_account_id: a.clientAccountId },
      })
    ).toBe(1);
  });
  it('serializes concurrent duplication to one winner', async () => {
    const a = await setup();
    const results = await Promise.all([a.duplicate(), a.duplicate()]);
    expect(results.filter(r => r.success)).toHaveLength(1);
    expect(results.filter(r => !r.success)).toMatchObject([
      { error: { type: 'SESSION_CONTAINER_PAIR_SESSION_EXISTS' } },
    ]);
    expect(
      await db.seeder.sessionContainer.count({
        where: {
          client_account_id: a.clientAccountId,
          lifecycle_state: { notIn: ['CLOSED', 'EXPIRED'] },
        },
      })
    ).toBe(1);
  });
  it('rolls back the newly created session on photo insert failure', async () => {
    const a = await setup();
    await db.seeder.$executeRawUnsafe(
      "CREATE FUNCTION fail_duplicate_photo() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected photo failure'; END $$"
    );
    await db.seeder.$executeRawUnsafe(
      'CREATE TRIGGER fail_duplicate_photo BEFORE INSERT ON "SessionContainerPhoto" FOR EACH ROW EXECUTE FUNCTION fail_duplicate_photo()'
    );
    try {
      expect(await a.duplicate()).toMatchObject({
        success: false,
        error: { type: 'DATABASE_ERROR' },
      });
      expect(
        await db.seeder.sessionContainer.count({
          where: { client_account_id: a.clientAccountId },
        })
      ).toBe(1);
    } finally {
      await db.seeder.$executeRawUnsafe(
        'DROP TRIGGER fail_duplicate_photo ON "SessionContainerPhoto"'
      );
      await db.seeder.$executeRawUnsafe('DROP FUNCTION fail_duplicate_photo()');
    }
  });
});
