import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { Client } from 'pg';
import { lifecycleActionsSql } from '../../src/domain/email/lifecycle-actions.sql';

const url = process.env.LIFECYCLE_TEST_DATABASE_URL;
describe.skipIf(!url)('lifecycle attribution on real PostgreSQL', () => {
  it('keeps inclusive boundaries, owner/account identity, last entry, and stable query count across pages', async () => {
    const client = new Client({
      connectionString: url ?? '',
      connectionTimeoutMillis: 5000,
    });
    const now = new Date('2026-10-21T12:00:00.000Z');
    const day = 86400000;
    const at = (offset: number) => new Date(now.getTime() + offset);
    const actions: Array<[string, string, string, Date]> = [
      ['a-last', 'owner', 'last', now],
      ['a-boundary', 'owner', 'boundary', now],
      ['a-expired', 'owner', 'expired', now],
      ['a-exact', 'owner', 'exact', now],
      ['a-future-entry', 'owner', 'future-entry', now],
      ['a-tie', 'owner', 'tie', now],
      ['a-foreign', 'foreign', 'last', now],
      ['a-too-old', 'owner', 'last', at(-90 * day - 1)],
      ['a-retention-boundary', 'owner', 'retention', at(-90 * day)],
      ['a-future-action', 'owner', 'last', at(1)],
    ];
    let queries = 0;
    const query = async (userId: string, cursor?: string) => {
      const sql = lifecycleActionsSql(userId, cursor, now);
      queries++;
      return (
        await client.query<{ id: string; entryId: string | null }>({
          text: sql.text,
          values: sql.values,
        })
      ).rows;
    };
    try {
      await client.connect();
      await client.query('BEGIN');
      await client.query(`
    CREATE TEMP TABLE "EmailLifecycleAction" ("id" text PRIMARY KEY, "userId" text NOT NULL, "accountId" text NOT NULL, "kind" text NOT NULL, "occurredAt" timestamp(3) NOT NULL);
    CREATE TEMP TABLE "EmailLifecycleMessage" ("id" text PRIMARY KEY, "userId" text NOT NULL, "accountId" text NOT NULL, "acceptedAt" timestamp(3), "family" text DEFAULT 'free', "ruleId" text DEFAULT 'free-first-client', "templateId" text DEFAULT 'free-first-client', "locale" text DEFAULT 'pl', "cohort" text DEFAULT 'new', "provider" text DEFAULT 'resend');
    CREATE TEMP TABLE "EmailLifecycleEntry" ("id" text PRIMARY KEY, "messageId" text NOT NULL, "userId" text NOT NULL, "ctaId" text DEFAULT 'primary', "createdAt" timestamp(3) NOT NULL);
  `);
      for (const [id, userId, accountId, occurredAt] of actions) {
        await client.query(
          'INSERT INTO "EmailLifecycleAction" VALUES ($1,$2,$3,$4,$5)',
          [id, userId, accountId, 'connection_accepted', occurredAt]
        );
      }
      const add = async (
        id: string,
        accountId: string,
        createdAt: Date,
        {
          user = 'owner',
          entryUser,
          accepted = true,
        }: { user?: string; entryUser?: string; accepted?: boolean } = {}
      ) => {
        await client.query(
          'INSERT INTO "EmailLifecycleMessage" ("id","userId","accountId","acceptedAt") VALUES ($1,$2,$3,$4)',
          [`m-${id}`, user, accountId, accepted ? at(-10 * day) : null]
        );
        await client.query(
          'INSERT INTO "EmailLifecycleEntry" ("id","messageId","userId","createdAt") VALUES ($1,$2,$3,$4)',
          [id, `m-${id}`, entryUser ?? user, createdAt]
        );
      };
      await add('e-old', 'last', at(-2 * day));
      await add('e-last', 'last', at(-day));
      await add('e-foreign', 'last', at(-1), { user: 'foreign' });
      await add('e-other-account', 'other-account', at(-1));
      await add('e-unaccepted', 'last', at(-1), { accepted: false });
      await add('e-other-entry-owner', 'last', at(-1), {
        entryUser: 'foreign',
      });
      await add('e-boundary', 'boundary', at(-7 * day));
      await add('e-expired', 'expired', at(-7 * day - 1));
      await add('e-exact', 'exact', now);
      await add('e-future-over-exact', 'exact', at(1));
      await add('e-future-only', 'future-entry', at(1));
      await add('e-tie-a', 'tie', at(-1000));
      await add('e-tie-z', 'tie', at(-1000));
      const rows = await query('owner');
      assert.equal(queries, 1);
      const entry = (id: string) => rows.find(row => row.id === id)?.entryId;
      assert.equal(entry('a-last'), 'e-last');
      assert.equal(entry('a-boundary'), 'e-boundary');
      assert.equal(entry('a-expired'), null);
      assert.equal(entry('a-exact'), 'e-exact');
      assert.equal(entry('a-future-entry'), null);
      assert.equal(entry('a-tie'), 'e-tie-z');
      assert(rows.some(row => row.id === 'a-retention-boundary'));
      assert(
        !rows.some(row =>
          ['a-foreign', 'a-too-old', 'a-future-action'].includes(row.id)
        )
      );
      assert.equal((await query('owner', 'a-foreign')).length, 0);
      assert.equal((await query('unknown-owner')).length, 0);
      for (let i = 0; i < 60; i++) {
        const id = `page-${String(i).padStart(3, '0')}`;
        actions.push([id, 'owner', 'last', at(-100)]);
        await client.query(
          'INSERT INTO "EmailLifecycleAction" VALUES ($1,$2,$3,$4,$5)',
          [id, 'owner', 'last', 'connection_accepted', at(-100)]
        );
      }
      const beforePages = queries;
      const first = await query('owner');
      const second = await query('owner', first.at(-1)?.id);
      assert.equal(queries - beforePages, 2);
      assert.equal(first.length, 50);
      const actualIds = [...first, ...second].map(row => row.id);
      const expectedCount = actions.filter(
        ([, owner, , time]) =>
          owner === 'owner' && time >= at(-90 * day) && time <= now
      ).length;
      assert.equal(actualIds.length, expectedCount);
      assert.equal(new Set(actualIds).size, expectedCount);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  });
});
