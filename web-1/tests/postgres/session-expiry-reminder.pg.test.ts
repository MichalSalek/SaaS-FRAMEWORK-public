import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { PrismaClient } from '../../src/prisma/js-client';
import type { AuthDb } from './auth-db.fixture';
import {
  createSessionActivityDb,
  sessionActivityFixture,
} from './session-activity.fixture';

const state = vi.hoisted(() => ({
  client: null as PrismaClient | null,
  afterShortlist: null as null | (() => Promise<void>),
  push: vi.fn(),
}));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    get use() {
      if (!state.client) {
        throw new Error('No test DB');
      }
      return state.client;
    },
  },
}));
vi.mock('@domain/notifications/push/push-dispatch.service', () => ({
  dispatchPushForNotification_IO: state.push,
}));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));
import { sendSessionExpiryReminders } from '@domain/session-container/session-container.expiry-reminder';

const url = process.env.SESSION_ACTIVITY_TEST_DATABASE_URL;
describe.skipIf(!url)('session expiry reminders on PostgreSQL', () => {
  let db: AuthDb;
  const now = new Date();
  beforeAll(async () => {
    db = await createSessionActivityDb(url ?? '');
    state.client = db.seeder.$extends({
      query: {
        sessionContainer: {
          async findMany({ args, query }) {
            const rows = await query(args);
            if (state.afterShortlist) {
              await state.afterShortlist();
            }
            return rows;
          },
        },
      },
    }) as unknown as PrismaClient;
  }, 120_000);
  beforeEach(() => {
    vi.clearAllMocks();
    state.afterShortlist = null;
    state.push.mockResolvedValue({
      sent: 0,
      failed: 0,
      gone: 0,
      skipped: 'no-devices',
    });
  });
  afterEach(async () => {
    state.afterShortlist = null;
    await db.seeder.notification.deleteMany({
      where: { type: 'SESSION_EXPIRING_SOON' },
    });
    await db.seeder.sessionContainer.updateMany({
      data: { expiry_reminder_sent_at: now },
    });
  });
  afterAll(async () => {
    state.client = null;
    await db?.drop();
  });
  const reminders = () =>
    db.seeder.notification.findMany({
      where: { type: 'SESSION_EXPIRING_SOON' },
      orderBy: { user_id: 'asc' },
    });
  const marker = async (id: string) =>
    (await db.seeder.sessionContainer.findUniqueOrThrow({ where: { id } }))
      .expiry_reminder_sent_at;

  it.each(['close', 'revoke'] as const)(
    'skips a %s committed after shortlist selection',
    async action => {
      const a = await sessionActivityFixture(db);
      let entered!: () => void;
      let release!: () => void;
      const reached = new Promise<void>(resolve => {
        entered = resolve;
      });
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      state.afterShortlist = async () => {
        entered();
        await gate;
      };
      const sweep = sendSessionExpiryReminders({ now });
      await reached;
      try {
        if (action === 'close') {
          await db.seeder.sessionContainer.update({
            where: { id: a.sessionId },
            data: { lifecycle_state: 'CLOSED', closed_at: now },
          });
        } else {
          await db.seeder.clientStylistPair.update({
            where: { id: a.pairId },
            data: { status: 'REVOKED' },
          });
        }
      } finally {
        release();
      }
      expect(await sweep).toBe(0);
      expect(await reminders()).toEqual([]);
      expect(await marker(a.sessionId)).toBeNull();
      expect(state.push).not.toHaveBeenCalled();
    }
  );

  it('does not restore a deleted stylist as the actor after the shortlist read', async () => {
    const a = await sessionActivityFixture(db);
    await db.seeder.stylistAccount.update({
      where: { account_id: a.stylistAccountId },
      data: { display_name: 'Deleted private name' },
    });
    let entered!: () => void;
    let release!: () => void;
    const reached = new Promise<void>(resolve => {
      entered = resolve;
    });
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    state.afterShortlist = async () => {
      entered();
      await gate;
    };
    const sweep = sendSessionExpiryReminders({ now });
    await reached;
    try {
      await db.seeder.user.delete({ where: { id: a.stylistUserId } });
    } finally {
      release();
    }
    expect(await sweep).toBe(1);
    const rows = await reminders();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: a.clientUserId,
      actor_user_id: null,
      actor_name: null,
    });
  });

  it('serializes concurrent ticks, stores no actor data and pushes only after commit', async () => {
    const a = await sessionActivityFixture(db);
    await db.seeder.user.update({
      where: { id: a.clientUserId },
      data: { name: 'Client private name' },
    });
    await db.seeder.stylistAccount.update({
      where: { account_id: a.stylistAccountId },
      data: { display_name: 'Stylist private name' },
    });
    const independent = db.makeClient().client;
    const pushVisibility: Array<{ notification: boolean; marker: boolean }> =
      [];
    state.push.mockImplementation(async ({ notification }) => {
      const committed = await independent.notification.findUnique({
        where: { id: notification.id },
      });
      const committedSession =
        await independent.sessionContainer.findUniqueOrThrow({
          where: { id: a.sessionId },
        });
      pushVisibility.push({
        notification: committed !== null,
        marker: committedSession.expiry_reminder_sent_at !== null,
      });
      return { sent: 0, failed: 0, gone: 0, skipped: 'no-devices' };
    });
    const results = await Promise.all([
      sendSessionExpiryReminders({ now }),
      sendSessionExpiryReminders({ now }),
    ]);
    expect(results.reduce((sum, count) => sum + count, 0)).toBe(1);
    const rows = await reminders();
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.user_id).sort()).toEqual(
      [a.clientUserId, a.stylistUserId].sort()
    );
    expect(
      rows.every(row => row.actor_name === null && row.actor_user_id === null)
    ).toBe(true);
    expect(state.push).toHaveBeenCalledTimes(2);
    expect(pushVisibility).toEqual([
      { notification: true, marker: true },
      { notification: true, marker: true },
    ]);
    expect(await marker(a.sessionId)).not.toBeNull();
  });

  it('rolls back both notification rows and marker on second write failure, then retries', async () => {
    const a = await sessionActivityFixture(db);
    await db.seeder.$executeRawUnsafe(
      `CREATE FUNCTION reminder_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.recipient_role::text = 'STYLIST' AND NEW.type::text = 'SESSION_EXPIRING_SOON' THEN RAISE EXCEPTION 'test second insert failure'; END IF; RETURN NEW; END $$`
    );
    await db.seeder.$executeRawUnsafe(
      'CREATE TRIGGER reminder_test_failure BEFORE INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION reminder_test_failure()'
    );
    try {
      expect(await sendSessionExpiryReminders({ now })).toBe(0);
      expect(await reminders()).toEqual([]);
      expect(await marker(a.sessionId)).toBeNull();
      expect(state.push).not.toHaveBeenCalled();
    } finally {
      await db.seeder.$executeRawUnsafe(
        'DROP TRIGGER reminder_test_failure ON "Notification"'
      );
      await db.seeder.$executeRawUnsafe(
        'DROP FUNCTION reminder_test_failure()'
      );
    }
    expect(await sendSessionExpiryReminders({ now })).toBe(1);
    expect(await reminders()).toHaveLength(2);
    expect(await marker(a.sessionId)).not.toBeNull();
  });

  it('reuses an existing intent without sending a duplicate push', async () => {
    const a = await sessionActivityFixture(db);
    await db.seeder.notification.create({
      data: {
        user_id: a.clientUserId,
        recipient_role: 'CLIENT',
        type: 'SESSION_EXPIRING_SOON',
        dedup_key: `SESSION_EXPIRING_SOON:${a.sessionId}`,
        target_path: `/app/sessions/${a.sessionId}`,
      },
    });
    expect(await sendSessionExpiryReminders({ now })).toBe(1);
    expect(await reminders()).toHaveLength(2);
    expect(state.push).toHaveBeenCalledTimes(1);
    expect(state.push).toHaveBeenCalledWith(
      expect.objectContaining({ userId: a.stylistUserId })
    );
  });
});
