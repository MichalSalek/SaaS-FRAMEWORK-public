import {
  afterAll,
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
  push: vi.fn(),
  emit: vi.fn(),
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
vi.mock('@app/events/event-bus', () => ({ emitInfoEventAndWait: state.emit }));
import { processSessionActivityOutbox_IO } from '@domain/session-container/session-activity.outbox';
import { acceptSessionContainer_IO } from '@domain/session-container/operations/session-container-accept.operation';

const url = process.env.SESSION_ACTIVITY_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname) ||
    !/^\/nf_session_activity_[a-z0-9_]+$/.test(parsed.pathname)
  ) {
    throw new Error(
      'Session activity test requires a dedicated loopback nf_session_activity_* database'
    );
  }
}

describe.skipIf(!url)('session activity outbox on real PostgreSQL', () => {
  let db: AuthDb;
  beforeAll(async () => {
    db = await createSessionActivityDb(url ?? '');
    state.client = db.seeder;
  }, 120_000);
  afterAll(async () => {
    state.client = null;
    await db?.drop();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    state.push.mockResolvedValue({ failed: 0 });
    state.emit.mockResolvedValue(undefined);
  });
  async function accepted() {
    const a = await sessionActivityFixture(db);
    const result = await acceptSessionContainer_IO({
      session_id: a.sessionId,
      stylist_account_id: a.stylistAccountId,
      user_id: a.stylistUserId,
    });
    expect(result.success).toBe(true);
    return a;
  }
  it('leases one delivery to one of two simultaneous workers', async () => {
    const a = await accepted();
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>(resolve => {
      release = resolve;
    });
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    state.push.mockImplementation(async () => {
      entered();
      await pending;
      return { failed: 0 };
    });
    const first = processSessionActivityOutbox_IO(a.sessionId);
    await started;
    try {
      const second = await processSessionActivityOutbox_IO(a.sessionId);
      expect(second.delivered).toBe(0);
      expect(state.push).toHaveBeenCalledTimes(1);
    } finally {
      release();
    }
    expect((await first).delivered).toBe(1);
    const row = await db.seeder.sessionActivityOutbox.findFirstOrThrow({
      where: { session_id: a.sessionId },
    });
    expect(row).toMatchObject({
      status: 'DELIVERED',
      attempts: 1,
      lease_token: null,
    });
  });
  it('persists a failed push and retries it without duplicating the event', async () => {
    const a = await accepted();
    state.push.mockRejectedValueOnce(new Error('simulated provider failure'));
    expect((await processSessionActivityOutbox_IO(a.sessionId)).failed).toBe(1);
    let row = await db.seeder.sessionActivityOutbox.findFirstOrThrow({
      where: { session_id: a.sessionId },
    });
    expect(row).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      last_error: 'simulated provider failure',
    });
    expect(row.next_attempt_at.getTime()).toBeGreaterThan(Date.now());
    await db.seeder.sessionActivityOutbox.update({
      where: { event_key: row.event_key },
      data: { next_attempt_at: new Date(0) },
    });
    expect((await processSessionActivityOutbox_IO(a.sessionId)).delivered).toBe(
      1
    );
    row = await db.seeder.sessionActivityOutbox.findUniqueOrThrow({
      where: { event_key: row.event_key },
    });
    expect(row).toMatchObject({
      status: 'DELIVERED',
      attempts: 2,
      last_error: null,
    });
    expect(
      await db.seeder.stylistClientMessage.count({
        where: { session_id: a.sessionId, kind: 'SESSION_ACCEPTED' },
      })
    ).toBe(1);
  });
  it('suppresses pending delivery after the pair is revoked', async () => {
    const a = await accepted();
    await db.seeder.clientStylistPair.update({
      where: { id: a.pairId },
      data: { status: 'REVOKED' },
    });
    await processSessionActivityOutbox_IO(a.sessionId);
    const row = await db.seeder.sessionActivityOutbox.findFirstOrThrow({
      where: { session_id: a.sessionId },
    });
    expect(row.status).toBe('SUPPRESSED');
    expect(state.push).not.toHaveBeenCalled();
  });

  it('suppresses pending delivery after derived salon access ends', async () => {
    const a = await accepted();
    await db.seeder.clientStylistPair.update({
      where: { id: a.pairId },
      data: { salon_origin_account_id: a.stylistAccountId },
    });
    await processSessionActivityOutbox_IO(a.sessionId);
    const row = await db.seeder.sessionActivityOutbox.findFirstOrThrow({
      where: { session_id: a.sessionId },
    });
    expect(row.status).toBe('SUPPRESSED');
    expect(state.push).not.toHaveBeenCalled();
  });

  it('recovers a committed intent when the immediate kick is lost', async () => {
    const a = await accepted();
    const before = await db.seeder.sessionActivityOutbox.findFirstOrThrow({
      where: { session_id: a.sessionId },
    });
    expect(before).toMatchObject({ status: 'PENDING', attempts: 0 });
    expect((await processSessionActivityOutbox_IO(a.sessionId)).delivered).toBe(
      1
    );
    expect(state.push).toHaveBeenCalledTimes(1);
  });

  it('suppresses delivery when the recipient mutes after commit', async () => {
    const a = await accepted();
    await db.seeder.clientStylistPair.update({
      where: { id: a.pairId },
      data: { client_hidden_at: new Date() },
    });
    await processSessionActivityOutbox_IO(a.sessionId);
    expect(
      (
        await db.seeder.sessionActivityOutbox.findFirstOrThrow({
          where: { session_id: a.sessionId },
        })
      ).status
    ).toBe('SUPPRESSED');
    expect(state.push).not.toHaveBeenCalled();
  });

  it('fences a stale worker after another worker recovers its expired lease', async () => {
    const a = await accepted();
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>(resolve => {
      release = resolve;
    });
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    state.push.mockImplementationOnce(async () => {
      entered();
      await pending;
      return { failed: 0 };
    });
    const old = processSessionActivityOutbox_IO(a.sessionId);
    await started;
    try {
      const lease = await db.seeder.sessionActivityOutbox.findFirstOrThrow({
        where: { session_id: a.sessionId },
      });
      await db.seeder.sessionActivityOutbox.update({
        where: { event_key: lease.event_key },
        data: { leased_until: new Date(0) },
      });
      expect(
        (await processSessionActivityOutbox_IO(a.sessionId)).delivered
      ).toBe(1);
    } finally {
      release();
    }
    expect((await old).delivered).toBe(0);
    const row = await db.seeder.sessionActivityOutbox.findFirstOrThrow({
      where: { session_id: a.sessionId },
    });
    expect(row).toMatchObject({
      status: 'DELIVERED',
      attempts: 2,
      lease_token: null,
    });
    // Lease fencing protects persisted state, not exactly-once provider delivery.
    expect(state.push).toHaveBeenCalledTimes(2);
  });
});
