import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthDb } from './auth-db.fixture';
import {
  createSessionActivityDb,
  sessionActivityFixture,
} from './session-activity.fixture';

const url = process.env.SESSION_ACTIVITY_TEST_DATABASE_URL;
// This test reconstructs the immediately prior schema by removing this migration's additive
// objects from the current Prisma-generated schema. It then executes the real migration file.
// It tests this migration and existing message backfill, not the full historical migration chain.
describe.skipIf(!url)(
  'session activity additive migration on PostgreSQL',
  () => {
    let db: AuthDb;
    let pool: Pool;
    beforeAll(async () => {
      db = await createSessionActivityDb(url ?? '');
      const rows = await db.seeder.$queryRaw<
        Array<{ schema: string }>
      >`SELECT current_schema() AS schema`;
      const schema = rows[0]?.schema;
      if (!schema || !/^auth_hot_path_[a-f0-9]+$/.test(schema)) {
        throw new Error('Unexpected temporary schema');
      }
      pool = new Pool({
        connectionString: url,
        max: 1,
        options: `-c search_path=${schema},public`,
      });
    }, 120_000);
    afterAll(async () => {
      await pool?.end();
      await db?.drop();
    });

    it('preserves existing text and timestamps and creates new defaults and CONTACT', async () => {
      const a = await sessionActivityFixture(db);
      const created = new Date('2025-02-03T04:05:06.123Z');
      const message = await db.seeder.stylistClientMessage.create({
        data: {
          pair_id: a.pairId,
          sender_type: 'CLIENT',
          content: 'Existing private message',
          created_at: created,
        },
      });
      // Reconstruct only columns, indexes, table and enums introduced by this exact additive migration.
      await pool.query(`
      DROP TABLE "SessionActivityOutbox";
      ALTER TABLE "Notification" DROP COLUMN "activity_kind", DROP COLUMN "session_id", DROP COLUMN "change_scope";
      ALTER TABLE "StylistClientMessage" DROP COLUMN "kind", DROP COLUMN "session_id", DROP COLUMN "change_scope", DROP COLUMN "event_key", DROP COLUMN "activity_at", DROP COLUMN "revision";
      ALTER TABLE "SessionContainer" DROP COLUMN "accepted_at", DROP COLUMN "last_client_change_at";
      DROP TYPE "SessionActivityKind"; DROP TYPE "SessionChangeScope";
      ALTER TABLE "ClientStylistPair" ALTER COLUMN "status" DROP DEFAULT;
      ALTER TYPE "PairingStatus" RENAME TO "PairingStatusAfter";
      CREATE TYPE "PairingStatus" AS ENUM ('ACTIVE', 'REVOKED', 'PENDING');
      ALTER TABLE "ClientStylistPair" ALTER COLUMN "status" TYPE "PairingStatus" USING "status"::text::"PairingStatus";
      ALTER TABLE "ClientStylistPair" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
      DROP TYPE "PairingStatusAfter";
    `);
      const migration = readFileSync(
        'src/prisma/migrations/20261106140000_session_activities_contact/migration.sql',
        'utf8'
      );
      await pool.query(migration);
      const row = await db.seeder.stylistClientMessage.findUniqueOrThrow({
        where: { id: message.id },
      });
      expect(row).toMatchObject({
        kind: 'TEXT',
        content: 'Existing private message',
        revision: 1,
        session_id: null,
        event_key: null,
      });
      expect(row.created_at.toISOString()).toBe(created.toISOString());
      expect(row.activity_at.toISOString()).toBe(created.toISOString());
      const session = await db.seeder.sessionContainer.findUniqueOrThrow({
        where: { id: a.sessionId },
      });
      expect(session.accepted_at).toBeNull();
      expect(session.last_client_change_at).toBeNull();
      await db.seeder.clientStylistPair.update({
        where: { id: a.pairId },
        data: { status: 'CONTACT' },
      });
      expect(
        (
          await db.seeder.clientStylistPair.findUniqueOrThrow({
            where: { id: a.pairId },
          })
        ).status
      ).toBe('CONTACT');
    });
  }
);
