import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import type { NextApiRequest, NextApiResponse } from 'next';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as UserSession from '../../src/domain/user/operations/user-session.operations';
import type * as Resolver from '../../src/application/pricing/effective-plan.resolver';
import {
  AUTH_DB_URL,
  createAuthDb,
  percentile,
  type AuthDb,
  type Counted,
} from './auth-db.fixture';

/**
 * The real SQL count and latency of request authentication
 * (`getCurrentUser_IO`), and the proof that a revoke in one process is seen by the very next
 * request of another (two clients with separate pools, see auth-db.fixture.ts).
 *
 * Run: AUTH_HOT_PATH_DATABASE_URL=postgresql://…@localhost:3200/db [AUTH_HOT_PATH_REPORT=out.json]
 *   npx vitest run --config vitest.postgres.config.ts tests/postgres/auth-hot-path.test.ts
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

const SAMPLES = Number(process.env.AUTH_HOT_PATH_SAMPLES ?? 60);

const fakeReq = (token: string) =>
  ({
    headers: { authorization: `Bearer ${token}` },
  }) as unknown as NextApiRequest;
const fakeRes = {} as NextApiResponse;

describe.skipIf(AUTH_DB_URL === undefined)(
  'auth hot path on real Postgres',
  () => {
    let db: AuthDb;
    let a: Counted;
    let b: Counted;
    let session: typeof UserSession;
    let resolver: typeof Resolver;
    const rows: Array<Record<string, string | number>> = [];
    const statements: Record<string, { first: string[]; warm: string[] }> = {};

    // Better Auth's Prisma adapter captures DB_CLIENT.use once, at import. Routing it through this
    // proxy lets every query of a resolution (Better Auth's included) run on, and be counted by,
    // the client of the "process" being measured.
    const current: { client: object } = { client: {} };
    const routed = new Proxy(
      {},
      {
        get(_target, prop) {
          const value: unknown = Reflect.get(
            current.client,
            prop,
            current.client
          );
          return typeof value === 'function'
            ? value.bind(current.client)
            : value;
        },
      }
    );

    const resolve = async (c: Counted, key: string) => {
      current.client = c.client;
      const before = c.count.n;
      const started = performance.now();
      const result = await session.getCurrentUser_IO({
        req: fakeReq(db.tokenOf(key)),
        res: fakeRes,
      });
      return {
        result,
        ms: performance.now() - started,
        sql: c.count.n - before,
        texts: c.count.texts.slice(before),
      };
    };

    const planOf = async (c: Counted, key: string) => {
      const run = await resolve(c, key);
      if (run.result.status !== 'AUTHENTICATED') {
        throw new Error(`${key} not authenticated`);
      }
      return run.result.output.user.stylist_account?.effective_pricing_plan;
    };

    const measure = async (scenario: string, key: string) => {
      const first = await resolve(a, key);
      expect(first.result.status).toBe('AUTHENTICATED');
      const times: number[] = [];
      const sqls: number[] = [];
      let lastTexts: string[] = [];
      for (let i = 0; i < SAMPLES; i += 1) {
        const run = await resolve(a, key);
        times.push(run.ms);
        sqls.push(run.sql);
        lastTexts = run.texts;
      }
      statements[scenario] = { first: first.texts, warm: lastTexts };
      rows.push({
        scenario,
        sql_first: first.sql,
        sql_warm: Math.max(...sqls),
        ms_first: Number(first.ms.toFixed(2)),
        p50: percentile(times, 50),
        p95: percentile(times, 95),
      });
    };

    beforeAll(async () => {
      db = await createAuthDb(AUTH_DB_URL ?? '');
      a = db.makeClient();
      b = db.makeClient();
      current.client = db.seeder;
      holder.client = routed;
      await db.seedUser('client', 'CLIENT');
      await db.seedUser('solo', 'STYLIST');
      await db.seedUser('owner', 'STYLIST', 'STUDIO');
      await db.seedUser('member', 'STYLIST');
      await db.seedUser('inv1', 'STYLIST');
      await db.seedUser('invmany', 'STYLIST');
      await db.seedUser('admin', 'ADMIN');
      await db.seedUser('pend1', 'STYLIST');
      await db.seedUser('pendmany', 'STYLIST');
      const salons = ['owner', 'salon2', 'salon3', 'salon4', 'salon5'];
      for (const salon of salons.slice(1)) {
        await db.seedUser(salon, 'STYLIST', 'STUDIO');
      }
      await db.seeder.staffMember.create({
        data: {
          stylist_account_id: 'sa_owner',
          user_id: db.idOf('member'),
          accepted_at: new Date(),
        },
      });
      // Two salons of the same tier, joined in reverse id order: both resolvers must name the same one.
      await db.seedUser('twin', 'STYLIST');
      for (const salon of ['sa_salon3', 'sa_salon2']) {
        await db.seeder.staffMember.create({
          data: {
            stylist_account_id: salon,
            user_id: db.idOf('twin'),
            accepted_at: new Date(),
          },
        });
      }
      await db.invite('inv1', 'owner', true);
      await db.invite('pend1', 'owner', false);
      for (const salon of salons) {
        await db.invite('invmany', salon, true);
        await db.invite('pendmany', salon, false);
      }
      session = await vi.importActual<typeof UserSession>(
        '@domain/user/operations/user-session.operations'
      );
      resolver = await vi.importActual<typeof Resolver>(
        '@app/pricing/effective-plan.resolver'
      );
    }, 120000);

    afterAll(async () => {
      const report = process.env.AUTH_HOT_PATH_REPORT;
      if (report !== undefined) {
        writeFileSync(report, JSON.stringify(rows, null, 2));
        writeFileSync(
          report.replace(/\.json$/, '.sql.json'),
          JSON.stringify(statements, null, 2)
        );
      }
      await db.drop();
    });

    it('measures SQL and latency per scenario', async () => {
      // Cold: the very first resolution on a fresh pool (connection setup included).
      const cold = await resolve(a, 'client');
      rows.push({
        scenario: 'cold process (client, first call)',
        sql_first: cold.sql,
        sql_warm: '-',
        ms_first: Number(cold.ms.toFixed(2)),
        p50: '-',
        p95: '-',
      });
      await measure('client', 'client');
      await measure('stylist without salon', 'solo');
      await measure('stylist with salon (member)', 'member');
      await measure('stylist, 1 attached invitation', 'inv1');
      await measure('stylist, 5 attached invitations', 'invmany');
      await measure('stylist, 1 accepted unattached invitation', 'pend1');
      await measure('stylist, 5 accepted unattached invitations', 'pendmany');
      await measure('salon owner (STUDIO)', 'owner');
      await measure('privileged (master admin)', 'admin');
    }, 120000);

    it('request authentication never attaches invitations', async () => {
      expect(await db.pendingOf('pendmany')).toBe(5);
      expect(await db.membershipsOf('pendmany')).toHaveLength(0);
    });

    it('the per-request resolver agrees with the batch resolver', async () => {
      current.client = a.client;
      for (const key of [
        'solo',
        'owner',
        'member',
        'inv1',
        'invmany',
        'admin',
        'twin',
      ]) {
        const ownPlan = key === 'owner' ? 'STUDIO' : 'FREE';
        expect(
          await resolver.resolveRequestEffectivePlan_IO({
            userId: db.idOf(key),
            ownPlan,
          })
        ).toEqual(
          await resolver.resolveEffectivePlan_IO({
            userId: db.idOf(key),
            ownPlan,
          })
        );
      }
    });

    it('a revoke in one process is seen by the next request of another', async () => {
      const member = {
        user_id: db.idOf('member'),
        stylist_account_id: 'sa_owner',
      };
      expect(await planOf(b, 'member')).toBe('STUDIO');

      // Process A: the member leaves. B's next request has lost the grant.
      await a.client.staffMember.updateMany({
        where: member,
        data: { is_active: false },
      });
      expect(await planOf(b, 'member')).toBe('FREE');

      // Restore, then process A downgrades the owner: B drops the grant at once.
      await a.client.staffMember.updateMany({
        where: member,
        data: { is_active: true },
      });
      expect(await planOf(b, 'member')).toBe('STUDIO');
      await a.client.stylistAccount.update({
        where: { account_id: 'sa_owner' },
        data: { pricing_plan: 'PRO' },
      });
      expect(await planOf(b, 'member')).toBe('FREE');

      // Process A disables the account: B's next request carries the disabled state
      // (the account-state gate downstream answers 403 USER_DISABLED).
      await a.client.user.update({
        where: { id: db.idOf('member') },
        data: { disabled_at: new Date() },
      });
      const afterDisable = await resolve(b, 'member');
      if (afterDisable.result.status !== 'AUTHENTICATED') {
        throw new Error('member not authenticated');
      }
      expect(afterDisable.result.output.user.disabled_at).not.toBeNull();

      // Process A deletes her sessions (log out everywhere): B answers anonymous.
      await a.client.session.deleteMany({
        where: { userId: db.idOf('member') },
      });
      expect((await resolve(b, 'member')).result.status).toBe('ANONYMOUS');
    });
  }
);
