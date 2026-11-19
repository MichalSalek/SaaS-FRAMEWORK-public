import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Invitations from '../../src/domain/salon-staff/salon-invitation-token.service';
import type * as BetterAuthConfig from '../../src/application/auth/better-auth/better-auth.config';
import { AUTH_DB_URL, createAuthDb, type AuthDb } from './auth-db.fixture';

/**
 * Accepted salon invitations attach on events, never per request. They attach
 * on the Better Auth sign-in (also when accepted before registration), survive a failed attempt,
 * and concurrent triggers never create a second membership.
 *
 * Run: AUTH_HOT_PATH_DATABASE_URL=postgresql://…@localhost:3200/db npx vitest run \
 *   --config vitest.postgres.config.ts tests/postgres/salon-invitation-attach.test.ts
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    get use() {
      if (holder.client === null) {
        throw new Error('Test database unavailable');
      }
      return holder.client;
    },
    useAppLogs: new Proxy(
      {},
      {
        get() {
          return async () => undefined;
        },
      }
    ),
  },
}));

describe.skipIf(AUTH_DB_URL === undefined)(
  'salon invitation attachment on real Postgres',
  () => {
    let db: AuthDb;
    let invitations: typeof Invitations;
    let betterAuth: typeof BetterAuthConfig;

    beforeAll(async () => {
      db = await createAuthDb(AUTH_DB_URL ?? '');
      holder.client = db.seeder;
      for (const salon of ['salon1', 'salon2', 'salon3']) {
        await db.seedUser(salon, 'STYLIST', 'STUDIO');
      }
      invitations = await vi.importActual<typeof Invitations>(
        '@domain/salon-staff/salon-invitation-token.service'
      );
      betterAuth = await vi.importActual<typeof BetterAuthConfig>(
        '@app/auth/better-auth/better-auth.config'
      );
    }, 120000);

    afterAll(async () => {
      await db.drop();
    });

    it('an invitation accepted before registration attaches on the Better Auth sign-in', async () => {
      holder.client = db.seeder;
      await db.invite('late', 'salon1', false);
      await db.seedUser('late', 'STYLIST');
      const context = await betterAuth.auth.$context;
      await context.internalAdapter.createSession(db.idOf('late'));
      // The sign-in hook does not hold the login: wait for it to finish.
      for (let i = 0; i < 50 && (await db.pendingOf('late')) > 0; i += 1) {
        await new Promise(done => setTimeout(done, 100));
      }
      expect(await db.pendingOf('late')).toBe(0);
      expect(await db.membershipsOf('late')).toHaveLength(1);
    });

    it('a failed attachment stays pending and the next event finishes it', async () => {
      holder.client = db.seeder;
      await db.seedUser('retry', 'STYLIST');
      await db.invite('retry', 'salon2', false);
      holder.client = new Proxy(db.seeder, {
        get(target, prop, receiver) {
          if (prop === '$transaction') {
            return async () => {
              throw new Error('simulated connection loss');
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      await expect(
        invitations.finishAcceptedSalonInvitations(db.idOf('retry'), 'test')
      ).resolves.toBeUndefined();
      holder.client = db.seeder;
      expect(await db.pendingOf('retry')).toBe(1);
      await invitations.finishAcceptedSalonInvitations(
        db.idOf('retry'),
        'test'
      );
      expect(await db.pendingOf('retry')).toBe(0);
      expect(await db.membershipsOf('retry')).toHaveLength(1);
    });

    it('concurrent triggers create one membership per salon', async () => {
      holder.client = db.seeder;
      await db.seedUser('race', 'STYLIST');
      await db.invite('race', 'salon3', false);
      await db.invite('race', 'salon1', false);
      await Promise.all(
        Array.from({ length: 4 }, () =>
          invitations.attachAcceptedSalonInvitations_IO(db.idOf('race'))
        )
      );
      const memberships = await db.membershipsOf('race');
      expect(memberships).toHaveLength(2);
      expect(new Set(memberships.map(m => m.stylist_account_id)).size).toBe(2);
      expect(await db.pendingOf('race')).toBe(0);
    });
  }
);
