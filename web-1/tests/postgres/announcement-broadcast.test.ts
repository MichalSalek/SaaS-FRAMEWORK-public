import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/prisma/js-client';
import { makeStylistCurrentUser } from '../../src/test-utils/fixtures';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';

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
vi.mock('@app/email-handler/lifecycle/email-locale-batch.resolver', () => ({
  batchResolveLocales: async () => new Map(),
}));
const push = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({
    sent: 0,
    failed: 0,
    gone: 0,
    skipped: 'no-devices' as const,
  }))
);
vi.mock('@domain/notifications/push/push-dispatch.service', () => ({
  dispatchPushForNotification_IO: push,
}));
import {
  pushAnnouncementNotification_IO,
  sendAnnouncementNotification_IO,
} from '../../src/domain/admin/operations/announcement-notification.operations';
import { testAnnouncementNotification_IO } from '../../src/domain/admin/operations/announcement-test.operations';

const url = process.env.ANNOUNCEMENT_TEST_DATABASE_URL;
const admin = makeStylistCurrentUser({
  user: { role_id: SystemRoleId.MASTER_ADMIN },
});
const translations = {
  pl: { title: 'News', message: 'Przeczytaj [wpis](/blog/a)' },
};
const ids = ['custom-broadcast-client', 'custom-broadcast-dual'];
let pool: Pool;
let client: PrismaClient;
const schema = `announcement_test_${randomUUID().replaceAll('-', '')}`;

describe.skipIf(!url)('announcement broadcast on disposable PostgreSQL', () => {
  beforeAll(async () => {
    if (!url) {
      throw new Error('Missing local test URL');
    }
    const parsed = new URL(url);
    if (
      !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
      !['/nf_custom', '/nf_ci'].includes(parsed.pathname)
    ) {
      throw new Error('Test wymaga jednorazowej lokalnej bazy testowej');
    }
    pool = new Pool({
      connectionString: url,
      options: `-c search_path=${schema},public`,
    });
    await pool.query(`CREATE SCHEMA "${schema}"`);
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
    await pool.query(sql);
    client = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
    holder.client = client;
    await client.role.create({
      data: { id: 'custom-broadcast-role', name: 'CUSTOM_BROADCAST' },
    });
    await client.user.createMany({
      data: ids.map(id => ({
        id,
        email: `${id}@example.test`,
        role_id: 'custom-broadcast-role',
      })),
    });
    await client.role.create({
      data: { id: SystemRoleId.MASTER_ADMIN, name: 'MASTER_ADMIN' },
    });
    await client.user.create({
      data: {
        id: admin.id,
        email: 'custom-broadcast-admin@example.test',
        role_id: SystemRoleId.MASTER_ADMIN,
      },
    });
    await client.clientAccount.createMany({
      data: ids.map(id => ({ created_by_user_id: id })),
    });
    await client.stylistAccount.create({
      data: {
        created_by_user_id: ids[1] ?? '',
        pricing_plan: 'FREE',
        payment_status: 'UNPAID',
        account_status: 'ACTIVE',
      },
    });
  });
  afterAll(async () => {
    const activeClient = holder.client;
    holder.client = null;
    if (activeClient !== null) {
      await activeClient.$disconnect();
    }
    if (typeof pool !== 'undefined') {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
  });
  it('two concurrent sends insert one bell and dispatch one push per person, including a dual-role user', async () => {
    await client.announcement.create({
      data: {
        id: 'custom-broadcast-race',
        title: 'News',
        message: 'News',
        translations,
        is_active: false,
      },
    });
    const results = await Promise.all(
      [1, 2].map(() =>
        sendAnnouncementNotification_IO({
          id: 'custom-broadcast-race',
          currentUser: admin,
        })
      )
    );
    expect(results.every(result => result.success)).toBe(true);
    expect(
      results.filter(result => result.success && result.data.created)
    ).toHaveLength(1);
    const rows = await client.notification.findMany({
      where: { announcement_id: 'custom-broadcast-race' },
    });
    expect(rows.map(row => row.user_id).sort()).toEqual([...ids].sort());
    expect(rows.every(row => row.recipient_role === null)).toBe(true);
    for (const result of results) {
      if (result.success) {
        await pushAnnouncementNotification_IO(result.data);
      }
    }
    expect(push).toHaveBeenCalledTimes(2);
    expect(
      (
        await client.announcement.findUniqueOrThrow({
          where: { id: 'custom-broadcast-race' },
        })
      ).notification_sent_at
    ).not.toBeNull();
    await client.announcement.delete({
      where: { id: 'custom-broadcast-race' },
    });
    expect(
      await client.notification.count({
        where: { announcement_id: 'custom-broadcast-race' },
      })
    ).toBe(0);
  });
  it('rolls inserted bells back when marking sent fails; a later retry remains possible', async () => {
    await client.announcement.create({
      data: {
        id: 'custom-broadcast-rollback',
        title: 'News',
        message: 'News',
        translations,
      },
    });
    await pool.query(
      `CREATE FUNCTION custom_broadcast_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = 'custom-broadcast-rollback' THEN RAISE EXCEPTION 'broadcast test rollback'; END IF; RETURN NEW; END $$`
    );
    await pool.query(
      'CREATE TRIGGER custom_broadcast_fail BEFORE UPDATE ON "Announcement" FOR EACH ROW EXECUTE FUNCTION custom_broadcast_fail()'
    );
    const failed = await sendAnnouncementNotification_IO({
      id: 'custom-broadcast-rollback',
      currentUser: admin,
    });
    expect(failed.success).toBe(false);
    expect(
      await client.notification.count({
        where: { announcement_id: 'custom-broadcast-rollback' },
      })
    ).toBe(0);
    expect(
      (
        await client.announcement.findUniqueOrThrow({
          where: { id: 'custom-broadcast-rollback' },
        })
      ).notification_sent_at
    ).toBeNull();
    await pool.query('DROP TRIGGER custom_broadcast_fail ON "Announcement"');
    const retried = await sendAnnouncementNotification_IO({
      id: 'custom-broadcast-rollback',
      currentUser: admin,
    });
    expect(retried.success && retried.data.created).toBe(true);
    expect(
      await client.notification.count({
        where: { announcement_id: 'custom-broadcast-rollback' },
      })
    ).toBe(2);
  });
  it('rehearses only for the admin and keeps tests out of the later real broadcast push', async () => {
    push.mockClear();
    const id = 'custom-broadcast-rehearsal';
    await client.announcement.create({
      data: { id, title: 'News', message: 'News', translations },
    });
    for (const _attempt of [1, 2]) {
      expect(
        (
          await testAnnouncementNotification_IO({
            id,
            locale: 'pl',
            currentUser: admin,
          })
        ).success
      ).toBe(true);
    }
    const tests = await client.notification.findMany({
      where: { announcement_id: id },
    });
    expect(tests).toHaveLength(1);
    expect(tests[0]?.user_id).toBe(admin.id);
    expect(
      (await client.announcement.findUniqueOrThrow({ where: { id } }))
        .notification_sent_at
    ).toBeNull();
    expect(push).toHaveBeenCalledTimes(2);
    push.mockClear();
    const result = await sendAnnouncementNotification_IO({
      id,
      currentUser: admin,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      await pushAnnouncementNotification_IO(result.data);
    }
    expect(push).toHaveBeenCalledTimes(2);
    expect(push.mock.calls.map(call => call[0])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: ids[0] }),
        expect.objectContaining({ userId: ids[1] }),
      ])
    );
    expect(
      await client.notification.count({ where: { announcement_id: id } })
    ).toBe(3);
  });
});
