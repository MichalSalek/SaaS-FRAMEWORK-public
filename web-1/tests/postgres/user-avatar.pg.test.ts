/** Real PostgreSQL proof; requires a disposable loopback nf_ci or nf_avatar_* database. */
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../src/prisma/js-client';
import { createAuthDb, type AuthDb } from './auth-db.fixture';
import {
  assertAvatarMigration,
  avatarAsset as asset,
  waitForUserLockWaiters,
} from './user-avatar.pg.fixture';
import type * as EnvironmentConfig from '@app/environment/environment.config';
import { lockStylistAccount, lockUserRow } from '@app/db/lock-rows';

const holder = vi.hoisted(() => ({
  client: null as PrismaClient | null,
  tasks: [] as Array<() => Promise<unknown>>,
  deleted: [] as string[],
}));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    get use() {
      if (!holder.client) {
        throw new Error('Test DB unavailable');
      }
      return holder.client;
    },
  },
}));
// Preserve the real reference-check sink; only replace the external vendor and scheduling.
vi.mock('@app/cloudinary/cloudinary.adapter', () => ({
  cloudinary: {
    api: {
      delete_resources: async (ids: string[]) => {
        holder.deleted.push(...ids);
        return { deleted: Object.fromEntries(ids.map(id => [id, 'deleted'])) };
      },
    },
  },
}));
vi.mock('@app/runtime/run-after-response', () => ({
  runAfterResponse: (task: () => Promise<unknown>) => {
    holder.tasks.push(task);
  },
}));
vi.mock('@app/environment/environment.config', async importOriginal => {
  const original = await importOriginal<typeof EnvironmentConfig>();
  return {
    ...original,
    ENV_VARS: { ...original.ENV_VARS, CLOUDINARY_CLOUD_NAME: 'avatar-test' },
  };
});

import { userSetAvatar_IO } from '@domain/user/operations/user-avatar.operations';
import { reconcileLegacyAvatarForUser_IO } from '@domain/user/operations/user-avatar-reconcile.operations';
import { setSalonLogo_IO } from '@domain/salon-profile/salon-logo.operations';

const url = process.env.AVATAR_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname) ||
    !/^\/nf_(ci|avatar_[a-z0-9_]+)$/.test(parsed.pathname)
  ) {
    throw new Error(
      'Avatar acceptance requires a disposable loopback nf_ci or nf_avatar_* database'
    );
  }
}
const flushCleanup = async () => {
  while (holder.tasks.length > 0) {
    const task = holder.tasks.shift();
    if (task) {
      await task();
    }
  }
};
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => {
    release = resolve;
  });
  return { promise, release };
};

describe.skipIf(!url)(
  'person avatar and independent salon logo on real Postgres',
  () => {
    let db: AuthDb;
    let blocker: PrismaClient;
    let inspector: Pool;
    beforeAll(async () => {
      // The fixture's Prisma CLI must never inherit a developer's direct/shadow URL.
      vi.stubEnv('DIRECT_DATABASE_URL', url ?? '');
      vi.stubEnv('SHADOW_DATABASE_URL', '');
      db = await createAuthDb(url ?? '');
      holder.client = db.seeder;
      blocker = db.makeClient().client;
      inspector = new Pool({ connectionString: url, max: 1 });
      await db.seedUser('owner', 'STYLIST', 'STUDIO');
      await db.seedUser('other', 'CLIENT');
      await db.seedUser('staff', 'STYLIST');
      await db.seeder.staffMember.create({
        data: {
          stylist_account_id: 'sa_owner',
          user_id: db.idOf('staff'),
          permissions: [],
          accepted_at: new Date(),
        },
      });
    }, 120000);
    afterAll(async () => {
      await flushCleanup();
      await inspector?.end();
      await db?.drop();
      vi.unstubAllEnvs();
    });

    it('applies the actual migration and repeats its backfill without replacing canonical values', async () => {
      await assertAvatarMigration(inspector);
    });

    it('writes and clears client-only avatars without altering OAuth', async () => {
      const id = db.idOf('other');
      await db.seeder.user.update({
        where: { id },
        data: { image: 'https://oauth.example/photo' },
      });
      expect(
        (await userSetAvatar_IO({ userId: id, avatar_url: asset('client') }))
          .success
      ).toBe(true);
      expect(
        await db.seeder.user.findUnique({
          where: { id },
          select: { avatar_url: true, image: true },
        })
      ).toEqual({
        avatar_url: asset('client'),
        image: 'https://oauth.example/photo',
      });
      expect(
        (await userSetAvatar_IO({ userId: id, avatar_url: null })).success
      ).toBe(true);
      expect(
        (await db.seeder.user.findUniqueOrThrow({ where: { id } })).image
      ).toBe('https://oauth.example/photo');
      await flushCleanup();
    });

    it('rejects a committed foreign avatar even with a transformed URL', async () => {
      const owner = db.idOf('owner');
      expect(
        (await userSetAvatar_IO({ userId: owner, avatar_url: asset('owner') }))
          .success
      ).toBe(true);
      const foreign = asset('owner').replace('/upload/', '/upload/w_100/');
      const result = await userSetAvatar_IO({
        userId: db.idOf('other'),
        avatar_url: foreign,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('VALIDATION_ERROR');
      }
      expect(
        (
          await db.seeder.user.findUniqueOrThrow({
            where: { id: db.idOf('other') },
          })
        ).avatar_url
      ).toBeNull();
      await flushCleanup();
    });

    it('keeps logo independent, rejects staff and leaves first setup unpublished', async () => {
      const owner = db.idOf('owner');
      expect(
        (
          await setSalonLogo_IO({
            accountId: 'sa_owner',
            userId: owner,
            logo_url: asset('logo'),
          })
        ).success
      ).toBe(true);
      const staff = await setSalonLogo_IO({
        accountId: 'sa_owner',
        userId: db.idOf('staff'),
        logo_url: null,
      });
      expect(staff.success).toBe(false);
      const row = await db.seeder.stylistAccount.findUniqueOrThrow({
        where: { account_id: 'sa_owner' },
      });
      expect(row).toMatchObject({
        avatar_url: asset('owner'),
        salon_logo_url: asset('logo'),
        salon_profile_name: null,
        salon_vanity_url: null,
      });
      expect(
        (await userSetAvatar_IO({ userId: owner, avatar_url: null })).success
      ).toBe(true);
      expect(
        (
          await db.seeder.stylistAccount.findUniqueOrThrow({
            where: { account_id: 'sa_owner' },
          })
        ).salon_logo_url
      ).toBe(asset('logo'));
      await flushCleanup();
    });

    it('serializes two concurrent writes using distinct connections and never cleans the final live URL', async () => {
      const id = db.idOf('owner');
      expect(
        (await userSetAvatar_IO({ userId: id, avatar_url: asset('start') }))
          .success
      ).toBe(true);
      await flushCleanup();
      holder.deleted.length = 0;
      const locked = gate();
      const release = gate();
      const held = blocker.$transaction(async tx => {
        await lockUserRow(tx, id);
        locked.release();
        await release.promise;
      });
      await locked.promise;
      const first = userSetAvatar_IO({
        userId: id,
        avatar_url: asset('concurrent'),
      });
      const second = userSetAvatar_IO({ userId: id, avatar_url: null });
      try {
        expect(
          await waitForUserLockWaiters(inspector, 2)
        ).toBeGreaterThanOrEqual(2);
      } finally {
        release.release();
      }
      await held;
      expect(
        (await Promise.all([first, second])).every(result => result.success)
      ).toBe(true);
      const user = await db.seeder.user.findUniqueOrThrow({ where: { id } });
      const stylist = await db.seeder.stylistAccount.findUniqueOrThrow({
        where: { account_id: 'sa_owner' },
      });
      expect(stylist.avatar_url).toBe(user.avatar_url);
      expect(stylist.avatar_public_id).toBe(user.avatar_public_id);
      await flushCleanup();
      expect(holder.deleted).toContain('nailfolio/start');
      if (user.avatar_public_id !== null) {
        expect(holder.deleted).not.toContain(user.avatar_public_id);
      }
    }, 15000);

    it('coexists with a User-then-Stylist profile transaction and reconciles a legacy clear', async () => {
      const id = db.idOf('owner');
      const userLocked = gate();
      const release = gate();
      const profile = blocker.$transaction(async tx => {
        await lockUserRow(tx, id);
        userLocked.release();
        await release.promise;
        await lockStylistAccount(tx, 'sa_owner');
        await tx.stylistAccount.update({
          where: { account_id: 'sa_owner' },
          data: { display_name: 'Profile updated' },
        });
      });
      await userLocked.promise;
      const photo = userSetAvatar_IO({
        userId: id,
        avatar_url: asset('before-legacy'),
      });
      try {
        expect(
          await waitForUserLockWaiters(inspector, 1)
        ).toBeGreaterThanOrEqual(1);
      } finally {
        release.release();
      }
      await profile;
      expect((await photo).success).toBe(true);
      await db.seeder.stylistAccount.update({
        where: { account_id: 'sa_owner' },
        data: { avatar_url: null, avatar_public_id: null },
      });
      await reconcileLegacyAvatarForUser_IO(id);
      const user = await db.seeder.user.findUniqueOrThrow({ where: { id } });
      const stylist = await db.seeder.stylistAccount.findUniqueOrThrow({
        where: { account_id: 'sa_owner' },
      });
      expect(user.avatar_url).toBeNull();
      expect(user.avatar_public_id).toBeNull();
      expect(stylist.avatar_url).toBeNull();
      expect(stylist.salon_logo_url).toBe(asset('logo'));

      // An old writer may have saved another user's address or an inconsistent id.
      expect(
        (
          await userSetAvatar_IO({
            userId: db.idOf('other'),
            avatar_url: asset('foreign-legacy'),
          })
        ).success
      ).toBe(true);
      await db.seeder.stylistAccount.update({
        where: { account_id: 'sa_owner' },
        data: {
          avatar_url: asset('foreign-legacy'),
          avatar_public_id: 'nailfolio/foreign-legacy',
        },
      });
      await expect(reconcileLegacyAvatarForUser_IO(id)).rejects.toThrow(
        'FOREIGN'
      );
      expect(
        (await db.seeder.user.findUniqueOrThrow({ where: { id } })).avatar_url
      ).toBeNull();
      await db.seeder.stylistAccount.update({
        where: { account_id: 'sa_owner' },
        data: {
          avatar_url: asset('owned-legacy'),
          avatar_public_id: 'nailfolio/wrong-id',
        },
      });
      await reconcileLegacyAvatarForUser_IO(id);
      const reconciled = await db.seeder.user.findUniqueOrThrow({
        where: { id },
      });
      expect(reconciled.avatar_url).toBe(asset('owned-legacy'));
      expect(reconciled.avatar_public_id).toBe('nailfolio/owned-legacy');
      expect(
        (
          await db.seeder.stylistAccount.findUniqueOrThrow({
            where: { account_id: 'sa_owner' },
          })
        ).avatar_public_id
      ).toBe('nailfolio/owned-legacy');
      await reconcileLegacyAvatarForUser_IO(id);
      await flushCleanup();
    }, 15000);
  }
);
