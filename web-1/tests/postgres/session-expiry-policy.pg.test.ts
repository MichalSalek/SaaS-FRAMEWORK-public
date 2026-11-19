import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { TIME } from '@kernel/application/constants.config';
import { SESSION_CONTAINER_CONFIG } from '@kernel/domain/session-container/session-container.config';
import { extendLiveSessionExpiryQuery } from '@domain/session-container/session-container.expiry-policy';

// SESSION_EXPIRY_TEST_DATABASE_URL must point to a disposable test database.
// Its temporary type and table cannot touch the real SessionContainer.
const url = process.env.SESSION_EXPIRY_TEST_DATABASE_URL;

describe.skipIf(!url)('session expiry extension on PostgreSQL', () => {
  const pool = new Pool({ connectionString: url, max: 1 });
  const now = new Date('2026-11-06T12:00:00.000Z');
  const day = TIME.MS_PER_DAY;
  const windowMs = SESSION_CONTAINER_CONFIG.SESSION_EXPIRY_DAYS * day;
  const shared = new Date(now.getTime() - 5 * day);
  const target = new Date(shared.getTime() + windowMs);
  const originalExpiry = new Date(shared.getTime() + 14 * day);

  beforeAll(async () => {
    await pool.query(
      `CREATE TYPE pg_temp."SessionContainerLifecycleState" AS ENUM ('DRAFT', 'READY', 'SHARED', 'ACTIVE', 'CLOSED', 'EXPIRED')`
    );
    await pool.query(`CREATE TEMP TABLE "SessionContainer" (
      "id" text PRIMARY KEY,
      "lifecycle_state" "SessionContainerLifecycleState" NOT NULL,
      "shared_at" timestamp(3), "expires_at" timestamp(3), "closed_at" timestamp(3),
      "client_note" text, "stylist_note" text, "updated_at" timestamp(3)
    )`);
    const cases: Array<
      [string, string, Date | null, Date | null, Date | null]
    > = [
      ['shared', 'SHARED', shared, originalExpiry, null],
      ['active', 'ACTIVE', shared, originalExpiry, null],
      ['later', 'SHARED', shared, new Date(target.getTime() + day), null],
      ['equal-target', 'SHARED', shared, target, null],
      ['boundary', 'SHARED', shared, now, null],
      ['past', 'ACTIVE', shared, new Date(now.getTime() - 1), null],
      ['no-expiry', 'SHARED', shared, null, null],
      ['no-share', 'SHARED', null, originalExpiry, null],
      ['closed-at', 'SHARED', shared, originalExpiry, now],
      ...['DRAFT', 'READY', 'CLOSED', 'EXPIRED'].map(
        state =>
          [state, state, shared, originalExpiry, null] as [
            string,
            string,
            Date,
            Date,
            null,
          ]
      ),
    ];
    for (const [id, state, sharedAt, expiry, closedAt] of cases) {
      await pool.query(
        `INSERT INTO "SessionContainer" VALUES ($1, $2::"SessionContainerLifecycleState", $3, $4, $5, 'client', 'stylist', $6)`,
        [id, state, sharedAt, expiry, closedAt, now]
      );
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('extends only old, live shared or active rows and is idempotent', async () => {
    const query = extendLiveSessionExpiryQuery(now);
    const before = (
      await pool.query('SELECT * FROM "SessionContainer" ORDER BY id')
    ).rows;
    const first = await pool.query(query.text, query.values);
    expect(first.rowCount).toBe(2);
    const after = (
      await pool.query('SELECT * FROM "SessionContainer" ORDER BY id')
    ).rows;
    for (let i = 0; i < before.length; i++) {
      const row = before[i];
      expect(after[i]).toEqual(
        row.id === 'shared' || row.id === 'active'
          ? { ...row, expires_at: target }
          : row
      );
    }
    const second = await pool.query(query.text, query.values);
    expect(second.rowCount).toBe(0);
    expect(
      (await pool.query('SELECT * FROM "SessionContainer" ORDER BY id')).rows
    ).toEqual(after);
  });
});
