import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/prisma/js-client';

/**
 * PLAN F7: the boot check of the migration-owned invariants is READ-ONLY. Connects as the role
 * the URL names (the matrix script passes a login role with DML rights only) to a database
 * migrated by scripts/db/migrate-deploy.sh, runs the real verifyDbInvariants and proves the role
 * cannot run the DDL the old boot step needed.
 *
 * Run through `npm run db:test:invariants` (throwaway containers), or by hand:
 * DB_INVARIANTS_TEST_DATABASE_URL=postgresql://<dml role>@…/<migrated db> npx vitest run \
 *   --config vitest.postgres.config.ts tests/postgres/db-invariants.test.ts
 * DB_INVARIANTS_MISMATCH_DATABASE_URL points at a database whose SC-2 index has the right name
 * and another predicate (the matrix builds it); the check must not be fooled by the name.
 */

const holder = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    get use() {
      if (!holder.client) {
        throw new Error('Test database unavailable');
      }
      return holder.client;
    },
  },
}));

import {
  SESSION_CONTAINER_ACTIVE_PAIR_INDEX,
  verifyDbInvariants,
} from '@app/startup/verify-db-invariants';

const url = process.env.DB_INVARIANTS_TEST_DATABASE_URL;
const mismatchUrl = process.env.DB_INVARIANTS_MISMATCH_DATABASE_URL;

describe.skipIf(!url)('verifyDbInvariants on real Postgres', () => {
  const pool = new Pool({ connectionString: url, max: 2 });

  beforeAll(() => {
    holder.client = new PrismaClient({ adapter: new PrismaPg(pool) });
  });

  afterAll(async () => {
    await holder.client?.$disconnect();
    await pool.end();
  });

  it('finds every invariant created by the migrations', async () => {
    await expect(verifyDbInvariants()).resolves.toEqual([]);
  });

  it('runs as a role that cannot create the index or the CHECK itself', async () => {
    await expect(
      pool.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS "probe_noddl_idx" ON "SessionContainer" ("id")'
      )
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      pool.query(
        'ALTER TABLE "StylistAccount" ADD CONSTRAINT "probe_noddl_ck" CHECK ("view_count" >= 0)'
      )
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe.skipIf(!mismatchUrl)(
  'verifyDbInvariants against a same-named wrong index',
  () => {
    const pool = new Pool({ connectionString: mismatchUrl, max: 2 });

    beforeAll(() => {
      holder.client = new PrismaClient({ adapter: new PrismaPg(pool) });
    });

    afterAll(async () => {
      await holder.client?.$disconnect();
      await pool.end();
    });

    it('reports definition_mismatch, not OK', async () => {
      await expect(verifyDbInvariants()).resolves.toEqual([
        {
          name: SESSION_CONTAINER_ACTIVE_PAIR_INDEX,
          kind: 'definition_mismatch',
        },
      ]);
    });
  }
);
