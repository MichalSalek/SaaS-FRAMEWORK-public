import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { expect } from 'vitest';

export const avatarAsset = (id: string) =>
  `https://res.cloudinary.com/example-cloud/image/upload/v123/nailfolio/${id}.jpg`;

export async function assertAvatarMigration(inspector: Pool): Promise<void> {
  const schema = `avatar_migration_${randomUUID().replaceAll('-', '')}`;
  const connection = await inspector.connect();
  try {
    await connection.query(`CREATE SCHEMA "${schema}"`);
    await connection.query(`SET search_path TO "${schema}", public`);
    await connection.query(
      'CREATE TABLE "users" ("id" text PRIMARY KEY, "image" text); CREATE TABLE "StylistAccount" ("account_id" text PRIMARY KEY, "created_by_user_id" text UNIQUE, "avatar_url" text, "avatar_public_id" text)'
    );
    await connection.query(
      'INSERT INTO "users" ("id", "image") VALUES ($1,$2),($3,$4),($5,$6)',
      ['u1', 'oauth', 'u2', 'oauth2', 'u3', null]
    );
    await connection.query(
      'INSERT INTO "StylistAccount" VALUES ($1,$2,$3,$4),($5,$6,$7,$8)',
      [
        's1',
        'u1',
        avatarAsset('legacy'),
        'nailfolio/legacy',
        's2',
        'u2',
        null,
        null,
      ]
    );
    const sql = readFileSync(
      'src/prisma/migrations/20261105200000_user_avatar_salon_logo/migration.sql',
      'utf8'
    );
    await connection.query(sql);
    const first = await connection.query(
      'SELECT "id", "image", "avatar_url", "avatar_public_id" FROM "users" ORDER BY "id"'
    );
    expect(first.rows).toEqual([
      {
        id: 'u1',
        image: 'oauth',
        avatar_url: avatarAsset('legacy'),
        avatar_public_id: 'nailfolio/legacy',
      },
      {
        id: 'u2',
        image: 'oauth2',
        avatar_url: null,
        avatar_public_id: null,
      },
      { id: 'u3', image: null, avatar_url: null, avatar_public_id: null },
    ]);
    await connection.query(
      'UPDATE "users" SET "avatar_url" = $1, "avatar_public_id" = $2 WHERE "id" = $3',
      [avatarAsset('custom'), 'nailfolio/custom', 'u1']
    );
    // Replay the complete migration, as a retry after a partial autocommit.
    await connection.query(sql);
    const again = await connection.query(
      'SELECT "avatar_url", "avatar_public_id" FROM "users" WHERE "id" = $1',
      ['u1']
    );
    expect(again.rows[0]).toEqual({
      avatar_url: avatarAsset('custom'),
      avatar_public_id: 'nailfolio/custom',
    });
    const logos = await connection.query(
      'SELECT "salon_logo_url", "salon_logo_public_id" FROM "StylistAccount"'
    );
    expect(
      logos.rows.every(
        row => row.salon_logo_url === null && row.salon_logo_public_id === null
      )
    ).toBe(true);
  } finally {
    await connection.query('SET search_path TO public');
    await connection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    connection.release();
  }
}

/** Observe real lock waiters before releasing the controlled blocking transaction. */
export async function waitForUserLockWaiters(
  inspector: Pool,
  minimum: number
): Promise<number> {
  let waiters = 0;
  for (let attempt = 0; attempt < 100 && waiters < minimum; attempt++) {
    const result = await inspector.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FROM "users"%' AND query LIKE '%FOR UPDATE%'`
    );
    waiters = Number(result.rows[0]?.n ?? 0);
    if (waiters < minimum) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  return waiters;
}
