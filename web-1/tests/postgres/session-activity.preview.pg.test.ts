import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../src/prisma/js-client';
import type { AuthDb } from './auth-db.fixture';
import {
  createSessionActivityDb,
  sessionActivityFixture,
} from './session-activity.fixture';
import { hydrateSessionActivityPreviews } from '@domain/session-container/session-activity.preview';

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

const url = process.env.SESSION_ACTIVITY_TEST_DATABASE_URL;
describe.skipIf(!url)('session activity current previews on PostgreSQL', () => {
  let db: AuthDb;
  beforeAll(async () => {
    db = await createSessionActivityDb(url ?? '');
    holder.client = db.seeder;
  }, 120_000);
  afterAll(async () => {
    holder.client = null;
    await db?.drop();
  });

  it('returns four current thumbnails and the real remaining count beyond 200 photos with viewer masking', async () => {
    const a = await sessionActivityFixture(db);
    const photos = Array.from({ length: 201 }, (_, index) => ({
      gallery_record_id: `qa_preview_${a.sessionId}_${index}`,
      created_by_account_id: a.stylistAccountId,
      asset_url: `https://example.test/qa/${index}.png`,
      nail_length: 'MEDIUM' as const,
    }));
    await db.seeder.galleryRecord.createMany({ data: photos });
    await db.seeder.sessionContainerPhoto.createMany({
      data: photos.map((photo, position) => ({
        session_id: a.sessionId,
        gallery_record_id: photo.gallery_record_id,
        position,
      })),
    });
    const message = {
      id: 'preview-card',
      sender_type: 'CLIENT' as const,
      kind: 'SESSION_SUBMITTED' as const,
      content: 'Shared session',
      created_at: new Date(),
      session_id: a.sessionId,
    };
    const client = {
      userId: a.clientUserId,
      clientAccountId: a.clientAccountId,
    };
    const first = await hydrateSessionActivityPreviews([message], client);
    expect(first[0]?.session_preview).toEqual({
      thumbnails: photos.slice(0, 4).map(photo => photo.asset_url),
      remaining_count: 197,
    });

    await db.seeder.galleryRecord.update({
      where: { gallery_record_id: photos[0]?.gallery_record_id ?? '' },
      data: { is_hidden: true },
    });
    const masked = await hydrateSessionActivityPreviews([message], client);
    expect(masked[0]?.session_preview).toEqual({
      thumbnails: photos.slice(1, 5).map(photo => photo.asset_url),
      remaining_count: 196,
    });
    const owner = await hydrateSessionActivityPreviews([message], {
      userId: a.stylistUserId,
      stylistAccountId: a.stylistAccountId,
    });
    expect(owner[0]?.session_preview?.remaining_count).toBe(197);
    expect(owner[0]?.session_preview?.thumbnails[0]).toBe(photos[0]?.asset_url);
  });
});
