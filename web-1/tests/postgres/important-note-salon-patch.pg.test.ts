import { AsyncLocalStorage } from 'node:async_hooks';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../src/prisma/js-client';
import type { AuthDb } from './auth-db.fixture';
import {
  createSessionActivityDb,
  sessionActivityFixture,
} from './session-activity.fixture';

const holder = vi.hoisted(() => ({
  client: null as PrismaClient | null,
  context: null as AsyncLocalStorage<PrismaClient> | null,
}));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    get use() {
      const client = holder.context?.getStore() ?? holder.client;
      if (!client) {
        throw new Error('No test DB');
      }
      return client;
    },
  },
}));
vi.mock('@app/maps/geocoding.utils', () => ({
  geocodeAddress: vi.fn(async () => null),
}));
import { upsertClientImportantNote_IO } from '@domain/client/operations/client-important-note.operations';
import { updateSalonProfile_IO } from '@domain/salon-profile/salon-profile.operations';

const url = process.env.SESSION_ACTIVITY_TEST_DATABASE_URL;
describe.skipIf(!url)(
  'important note CAS and salon patches on PostgreSQL',
  () => {
    let db: AuthDb;
    let first: PrismaClient;
    let second: PrismaClient;
    const context = new AsyncLocalStorage<PrismaClient>();
    beforeAll(async () => {
      db = await createSessionActivityDb(url ?? '');
      holder.client = db.seeder;
      holder.context = context;
      first = db.makeClient().client;
      second = db.makeClient().client;
    }, 120_000);
    afterAll(async () => {
      holder.client = null;
      holder.context = null;
      await db?.drop();
    });

    it('serializes two revisions, advances same-ms revisions, and retains clear tombstones', async () => {
      const a = await sessionActivityFixture(db);
      const ids = {
        client_user_id: a.clientUserId,
        stylist_account_id: a.stylistAccountId,
      };
      const [left, right] = await Promise.all([
        context.run(first, () =>
          upsertClientImportantNote_IO({
            ...ids,
            note: 'first',
            expected_updated_at: null,
          })
        ),
        context.run(second, () =>
          upsertClientImportantNote_IO({
            ...ids,
            note: 'second',
            expected_updated_at: null,
          })
        ),
      ]);
      expect([left, right].filter(result => result.success)).toHaveLength(1);
      expect(
        [left, right].filter(
          result => !result.success && result.error.type === 'VALIDATION_ERROR'
        )
      ).toHaveLength(1);
      const future = new Date(Date.now() + 60_000);
      await db.seeder.clientStylistPair.update({
        where: { id: a.pairId },
        data: { important_note_updated_at: future },
      });
      const next = await context.run(first, () =>
        upsertClientImportantNote_IO({ ...ids, note: 'legacy' })
      );
      expect(next.success && next.data.updatedAt).toBe(
        new Date(future.getTime() + 1).toISOString()
      );
      const clear = await context.run(second, () =>
        upsertClientImportantNote_IO({
          ...ids,
          note: '',
          expected_updated_at: new Date(future.getTime() + 1).toISOString(),
        })
      );
      expect(clear.success && clear.data).toEqual({
        note: null,
        updatedAt: new Date(future.getTime() + 2).toISOString(),
      });
      const stale = await context.run(first, () =>
        upsertClientImportantNote_IO({
          ...ids,
          note: 'old',
          expected_updated_at: null,
        })
      );
      expect(stale).toMatchObject({
        success: false,
        error: { type: 'VALIDATION_ERROR', field: 'note' },
      });
      const restored = await context.run(second, () =>
        upsertClientImportantNote_IO({
          ...ids,
          note: 'restored',
          expected_updated_at: new Date(future.getTime() + 2).toISOString(),
        })
      );
      expect(restored.success && restored.data.updatedAt).toBe(
        new Date(future.getTime() + 3).toISOString()
      );
      await db.seeder.clientStylistPair.update({
        where: { id: a.pairId },
        data: { status: 'REVOKED' },
      });
      const revokedWrite = await upsertClientImportantNote_IO({
        ...ids,
        note: 'forbidden',
      });
      expect(revokedWrite).toMatchObject({
        success: false,
        error: { type: 'CLIENT_UNAUTHORIZED_ACCESS' },
      });
      const revokedClear = await upsertClientImportantNote_IO({
        ...ids,
        note: '',
        expected_updated_at: new Date(future.getTime() + 3).toISOString(),
      });
      expect(revokedClear.success && revokedClear.data.note).toBeNull();
    }, 120_000);

    it('keeps unrelated team, contact and pin changes across two clients', async () => {
      await db.seedUser('patch_owner', 'STYLIST', 'STUDIO');
      const accountId = 'sa_patch_owner';
      const work = await db.seeder.galleryRecord.create({
        data: {
          created_by_account_id: accountId,
          asset_url: 'https://example.com/work.jpg',
          nail_length: 'SHORT',
        },
      });
      const other = await db.seeder.galleryRecord.create({
        data: {
          created_by_account_id: accountId,
          asset_url: 'https://example.com/other.jpg',
          nail_length: 'SHORT',
        },
      });
      await db.seeder.salonShowcaseWork.create({
        data: {
          salon_account_id: accountId,
          gallery_record_id: work.gallery_record_id,
        },
      });
      const results = await Promise.all([
        context.run(first, () =>
          updateSalonProfile_IO({ accountId, body: { show_team: false } })
        ),
        context.run(second, () =>
          updateSalonProfile_IO({
            accountId,
            body: { contact: { website: 'https://example.com' } },
          })
        ),
        context.run(first, () =>
          updateSalonProfile_IO({
            accountId,
            body: { pinned_record_ids: [other.gallery_record_id] },
          })
        ),
      ]);
      expect(results.every(result => result.success)).toBe(true);
      const owner = await db.seeder.stylistAccount.findUniqueOrThrow({
        where: { account_id: accountId },
      });
      expect(owner.salon_show_team).toBe(false);
      expect(owner.website).toBe('https://example.com');
      expect(
        await db.seeder.salonShowcaseWork.findMany({
          where: { salon_account_id: accountId },
        })
      ).toMatchObject([{ gallery_record_id: other.gallery_record_id }]);
      const legacy = await updateSalonProfile_IO({
        accountId,
        body: {
          name: 'Legacy',
          brand_accent_color: null,
          show_team: true,
          pinned_record_ids: [work.gallery_record_id],
          contact: {
            address_city: 'Warszawa',
            address_street: 'Długa 1',
            address_country: 'PL',
          },
        },
      });
      expect(legacy.success).toBe(true);
      const invalid = await updateSalonProfile_IO({
        accountId,
        body: { contact: { address_city: null } },
      });
      expect(invalid).toMatchObject({
        success: false,
        error: { type: 'VALIDATION_ERROR', field: 'address_city' },
      });
      const clear = await updateSalonProfile_IO({
        accountId,
        body: { pinned_record_ids: [] },
      });
      expect(clear.success).toBe(true);
      expect(
        await db.seeder.salonShowcaseWork.count({
          where: { salon_account_id: accountId },
        })
      ).toBe(0);
    }, 120_000);
  }
);
