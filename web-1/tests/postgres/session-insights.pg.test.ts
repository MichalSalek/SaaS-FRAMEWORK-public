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
import { getSessionInsights_IO } from '@domain/session-container/operations/session-insights.operations';

const url = process.env.SESSION_ACTIVITY_TEST_DATABASE_URL;
describe.skipIf(!url)('session insights on real PostgreSQL', () => {
  let db: AuthDb;
  beforeAll(async () => {
    db = await createSessionActivityDb(url ?? '');
    holder.client = db.seeder;
  }, 120_000);
  afterAll(async () => {
    holder.client = null;
    await db?.drop();
  });

  it('counts and aggregates only shared sessions readable by the stylist on paid and free plans', async () => {
    const a = await sessionActivityFixture(db);
    const foreign = await sessionActivityFixture(db);
    const addPhoto = async (
      sessionId: string,
      name: string,
      length: 'SHORT' | 'LONG'
    ) => {
      const color = await db.seeder.color.create({
        data: { name, hex_code: '#123456' },
      });
      const trait = await db.seeder.trait.create({
        data: { name, category: 'style' },
      });
      const record = await db.seeder.galleryRecord.create({
        data: {
          created_by_account_id: a.stylistAccountId,
          asset_url: `https://example.test/${name}`,
          nail_length: length,
          colors: { create: { color_id: color.id } },
          traits: { create: { trait_id: trait.id } },
        },
      });
      await db.seeder.sessionContainerPhoto.create({
        data: {
          session_id: sessionId,
          gallery_record_id: record.gallery_record_id,
        },
      });
      return record.gallery_record_id;
    };
    const visibleRecord = await addPhoto(a.sessionId, 'visible', 'SHORT');
    const closedShared = await db.seeder.sessionContainer.create({
      data: {
        client_account_id: a.clientAccountId,
        stylist_account_id: a.stylistAccountId,
        lifecycle_state: 'CLOSED',
        shared_at: new Date(),
        closed_at: new Date(),
      },
    });
    await db.seeder.sessionContainerPhoto.create({
      data: {
        session_id: closedShared.id,
        gallery_record_id: visibleRecord,
      },
    });
    for (const state of ['DRAFT', 'CLOSED'] as const) {
      const hidden = await db.seeder.sessionContainer.create({
        data: {
          client_account_id: a.clientAccountId,
          stylist_account_id: a.stylistAccountId,
          lifecycle_state: state,
          shared_at: null,
        },
      });
      await addPhoto(hidden.id, `private-${state}`, 'LONG');
    }
    const ready = await db.seeder.sessionContainer.create({
      data: {
        client_account_id: a.clientAccountId,
        stylist_account_id: a.stylistAccountId,
        lifecycle_state: 'READY',
        shared_at: new Date(),
      },
    });
    await addPhoto(ready.id, 'private-READY', 'LONG');
    await addPhoto(foreign.sessionId, 'other-stylist', 'LONG');

    const insights = (pricing_plan: 'FREE' | 'PRO') =>
      getSessionInsights_IO({
        stylist_account_id: a.stylistAccountId,
        pricing_plan,
      });
    const paid = await insights('PRO');
    expect(paid.success && paid.data).toEqual({
      available: true,
      sessions_count: 2,
      photos_count: 2,
      top_colors: [{ name: 'visible', hex_code: '#123456', count: 1 }],
      top_traits: [{ name: 'visible', count: 1 }],
      top_lengths: [{ length: 'SHORT', count: 1 }],
    });
    const free = await insights('FREE');
    expect(free.success && free.data).toEqual({
      available: false,
      sessions_count: 2,
      photos_count: 2,
      top_colors: [],
      top_traits: [],
      top_lengths: [],
    });

    await db.seeder.clientStylistPair.update({
      where: { id: a.pairId },
      data: { status: 'CONTACT' },
    });
    const contact = await insights('PRO');
    expect(contact.success && contact.data).toEqual({
      available: true,
      sessions_count: 0,
      photos_count: 0,
      top_colors: [],
      top_traits: [],
      top_lengths: [],
    });
    await db.seeder.clientStylistPair.update({
      where: { id: a.pairId },
      data: { status: 'PENDING' },
    });
    const pending = await insights('PRO');
    expect(pending.success && pending.data).toEqual(
      contact.success && contact.data
    );
    await db.seeder.clientStylistPair.update({
      where: { id: a.pairId },
      data: { status: 'REVOKED' },
    });
    const archived = await insights('PRO');
    expect(archived.success && archived.data).toEqual(
      paid.success && paid.data
    );
    await db.seeder.user.update({
      where: { id: a.clientUserId },
      data: { is_active: false },
    });
    const inactive = await insights('PRO');
    expect(inactive.success && inactive.data).toEqual({
      available: true,
      sessions_count: 0,
      photos_count: 0,
      top_colors: [],
      top_traits: [],
      top_lengths: [],
    });
  });
});
