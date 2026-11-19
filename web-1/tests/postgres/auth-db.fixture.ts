import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/prisma/js-client';

/**
 * Throwaway real-Postgres world for the auth hot-path suites.
 *
 * Counts every statement that reaches Postgres (BEGIN/COMMIT included), not Prisma method calls:
 * each pooled connection's `query` is wrapped. Each `makeClient()` has its own pool, so two of them
 * stand in for two web-1 processes (no shared memory, separate connections). The schema is created
 * from schema.prisma and dropped by `drop()`; nothing else in the database is touched.
 */

export type Counted = {
  client: PrismaClient;
  count: { n: number; texts: string[] };
};

export const AUTH_DB_URL = process.env.AUTH_HOT_PATH_DATABASE_URL;

export const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((x, y) => x - y);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return Number((sorted[index] ?? 0).toFixed(2));
};

export const createAuthDb = async (url: string) => {
  const schema = 'auth_hot_path_' + randomUUID().replaceAll('-', '');
  const sql = execFileSync(
    'npx',
    [
      'prisma',
      'migrate',
      'diff',
      '--from-empty',
      '--to-schema',
      'src/prisma/schema.prisma',
      '--script',
    ],
    { encoding: 'utf8', env: { ...process.env, DATABASE_URL: url } }
  );
  const admin = new Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.query(`SET search_path TO "${schema}", public; ${sql}`);
  await admin.end();

  const clients: Counted[] = [];
  const makeClient = (): Counted => {
    const count = { n: 0, texts: [] as string[] };
    const pool = new Pool({
      connectionString: url,
      options: `-c search_path=${schema},public`,
      max: 4,
    });
    pool.on('connect', (connection: PoolClient) => {
      const original = connection.query.bind(connection) as (
        ...args: unknown[]
      ) => unknown;
      (
        connection as unknown as { query: (...args: unknown[]) => unknown }
      ).query = (...args: unknown[]) => {
        count.n += 1;
        const first = args[0];
        count.texts.push(
          typeof first === 'string'
            ? first
            : String((first as { text?: unknown } | null)?.text ?? '')
        );
        return original(...args);
      };
    });
    const counted = {
      client: new PrismaClient({
        adapter: new PrismaPg(pool, { schema, disposeExternalPool: true }),
      }),
      count,
    };
    clients.push(counted);
    return counted;
  };

  const seeder = makeClient().client;
  await seeder.role.createMany({
    data: [
      { id: 'role_client', name: 'CLIENT' },
      { id: 'role_stylist', name: 'STYLIST' },
      { id: 'role_master_admin', name: 'MASTER_ADMIN' },
    ],
  });

  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const idOf = (key: string): string => {
    const id = ids[key];
    if (id === undefined) {
      throw new Error(`no seeded user ${key}`);
    }
    return id;
  };
  const tokenOf = (key: string): string => tokens[key] ?? '';

  const seedUser = async (
    key: string,
    kind: 'CLIENT' | 'STYLIST' | 'ADMIN',
    plan: 'FREE' | 'STUDIO' = 'FREE'
  ) => {
    const id = `u_${key}_${randomBytes(4).toString('hex')}`;
    ids[key] = id;
    await seeder.user.create({
      data: {
        id,
        email: `${key}@hot-path.test`,
        role_id:
          kind === 'CLIENT'
            ? 'role_client'
            : kind === 'ADMIN'
              ? 'role_master_admin'
              : 'role_stylist',
        account_type: kind === 'CLIENT' ? 'CLIENT' : 'STYLIST',
        is_active: true,
        emailVerified: true,
      },
    });
    if (kind === 'CLIENT') {
      await seeder.clientAccount.create({ data: { created_by_user_id: id } });
    } else {
      await seeder.stylistAccount.create({
        data: {
          account_id: `sa_${key}`,
          created_by_user_id: id,
          pricing_plan: plan,
          payment_status: 'PAID',
          account_status: 'ACTIVE',
          subscription_status: plan === 'STUDIO' ? 'ACTIVE' : null,
        },
      });
    }
    const token = randomBytes(32).toString('hex');
    tokens[key] = token;
    await seeder.session.create({
      data: { token, userId: id, expires: new Date(Date.now() + 86400000) },
    });
  };

  /** An accepted invitation of `key` to the salon of `salon`; `attached` marks it already finished. */
  const invite = async (key: string, salon: string, attached: boolean) => {
    await seeder.salonInvitation.create({
      data: {
        salon_account_id: `sa_${salon}`,
        email: `${key}@hot-path.test`,
        token_hash: randomBytes(32).toString('hex'),
        expires_at: new Date(Date.now() + 86400000),
        accepted_at: new Date(),
        attached_user_id: attached ? idOf(key) : null,
      },
    });
  };

  const membershipsOf = (key: string) =>
    seeder.staffMember.findMany({ where: { user_id: idOf(key) } });
  const pendingOf = (key: string) =>
    seeder.salonInvitation.count({
      where: { email: `${key}@hot-path.test`, attached_user_id: null },
    });

  const drop = async () => {
    for (const counted of clients) {
      await counted.client.$disconnect();
    }
    const admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  };

  return {
    makeClient,
    seeder,
    seedUser,
    invite,
    idOf,
    tokenOf,
    membershipsOf,
    pendingOf,
    drop,
  };
};

export type AuthDb = Awaited<ReturnType<typeof createAuthDb>>;
