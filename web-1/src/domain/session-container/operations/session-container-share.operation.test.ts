import { mockSessionDb } from '../../../test-utils/share-session-db.fixture';
/**
 * SessionContainer SHARE unit tests — shareSessionContainer_IO (domain-unit).
 *
 * Covers the full guard ladder plus the TTL write value SHARE keys on: SHARE is the
 * ONLY place expires_at is minted (shared_at + SESSION_EXPIRY_DAYS,
 * SESSION_EXPIRY_DAYS) inside the SC-6 atomic CAS updateMany (WHERE lifecycle_state
 * IN (DRAFT,READY)). Also: SC-4 — expired-but-unswept sessions must not occupy an
 * active-cap slot (the count's TTL filter); the CAS-loser branch (count=0 →
 * INVALID_STATE, never a double-share); the hourly brake of the SENDER (counted
 * for this client → this stylist pair only, a platform constant, never the
 * stylist's plan: one client must not be able to lock a stylist's inbox for
 * everybody else); and the POST-UPDATE VERIFY active race (__SHARE_ACTIVE_RACE__)
 * surfacing a typed failure instead of an unmapped 500.
 */

import { describe, it, expect, vi } from 'vitest';
import type { mockDb } from '../../../test-utils/mockApiHandler';
import {
  SESSION_SHARES_PER_PAIR_PER_HOUR,
  shareSessionContainer_IO,
} from './session-container-share.operation';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';
import { SESSION_CONTAINER_CONFIG } from '@kernel/domain/session-container/session-container.config';
import { TIME } from '@kernel/application/constants.config';

// The shared-session limit reads rows (stylist per session) instead of a bare
// count since the salon exclusion (kernel session-container.limit.ts). Tests
// keep describing the limit as a number: `count` answers the active-slot WHERE
// and `findMany` turns it into that many rows with distinct, direct stylists.
type MockSpec = Parameters<typeof mockDb>[0];

const SESSION_ID = 'sess_test_000000000000001';
const CLIENT_USER_ID = 'usr_client_00000000000001';
const CLIENT_ACCOUNT_ID = 'cli_test_0000000000000001';
const STYLIST_ACCOUNT_ID = 'acc_stylist_0000000000001';

const makeRow = (overrides: Record<string, unknown> = {}) => ({
  id: SESSION_ID,
  client_account_id: CLIENT_ACCOUNT_ID,
  stylist_account_id: STYLIST_ACCOUNT_ID,
  name: null,
  lifecycle_state: SessionContainerLifecycleStateValue.READY,
  stylist_note: null,
  client_note: null,
  shared_at: null,
  expires_at: null,
  closed_at: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const runOp = () =>
  shareSessionContainer_IO({
    client_user_id: CLIENT_USER_ID,
    client_account_id: CLIENT_ACCOUNT_ID,
    session_id: SESSION_ID,
  });

const makeCount = (activeSeq: number[], shareSeq: number[]) => {
  let activeCall = 0;
  let shareCall = 0;
  return vi.fn(async (arg: unknown) => {
    const where = (arg as { where: Record<string, unknown> }).where;
    if ('shared_at' in where) {
      const value = shareSeq[Math.min(shareCall, shareSeq.length - 1)] ?? 0;
      shareCall += 1;
      return value;
    }
    const value = activeSeq[Math.min(activeCall, activeSeq.length - 1)] ?? 0;
    activeCall += 1;
    return value;
  });
};

const installShareDb = (opts: {
  row?: Record<string, unknown>;
  pair?: unknown;
  photoCount?: number;
  count?: ReturnType<typeof makeCount>;
  updateManyCount?: number;
}) => {
  const sharedRow = makeRow({
    ...opts.row,
    lifecycle_state: SessionContainerLifecycleStateValue.SHARED,
  });
  const updateMany = vi.fn(async (_arg: unknown) => ({
    count: opts.updateManyCount ?? 1,
  }));
  const count = opts.count ?? makeCount([0], [0]);
  // The stylist's plan must never be consulted on the share path.
  const readStylistPlan = vi.fn(async () => ({ pricing_plan: 'FREE' }));
  mockSessionDb({
    $queryRaw: (async () => [
      { id: 'pair_1', last_message_at: null },
    ]) as unknown as MockSpec[string],
    sessionContainer: {
      findUnique: async () => ({
        ...makeRow(opts.row ?? {}),
        client_account: { created_by_user_id: CLIENT_USER_ID },
      }),
      findUniqueOrThrow: async () =>
        makeRow({
          lifecycle_state: SessionContainerLifecycleStateValue.SHARED,
          shared_at: new Date(),
          expires_at: new Date(Date.now() + 7 * TIME.MS_PER_DAY),
          ...opts.row,
        }),
      count,
      updateMany,
    },
    clientStylistPair: {
      findFirst: async () => ('pair' in opts ? opts.pair : { id: 'pair_1' }),
      findUnique: async () => ({
        id: 'pair_1',
        client_user_id: CLIENT_USER_ID,
        stylist_account_id: STYLIST_ACCOUNT_ID,
        status: 'ACTIVE',
        client_hidden_at: null,
        stylist_hidden_at: null,
        client_user: { id: CLIENT_USER_ID, name: 'Client', is_active: true },
        stylist_account: {
          created_by_user_id: 'stylist_user',
          created_by_user: { name: 'Stylist', is_active: true },
        },
      }),
      update: async () => ({}),
    },
    sessionContainerPhoto: {
      count: async () => opts.photoCount ?? 1,
    },
    stylistAccount: { findUnique: readStylistPlan, findMany: async () => [] },
    stylistClientMessage: {
      findFirst: async () => null,
      upsert: async () => ({ id: 'message_1' }),
    },
    notification: { upsert: async () => ({ id: 'notification_1' }) },
    sessionActivityOutbox: { upsert: async () => ({}) },
    emailLifecycleMessage: { createMany: async () => ({ count: 0 }) },
  });
  return { updateMany, count, sharedRow, readStylistPlan };
};

describe('shareSessionContainer_IO — pre-flight guards', () => {
  it('unknown session → NOT_FOUND', async () => {
    mockSessionDb({ sessionContainer: { findUnique: async () => null } });
    const result = await runOp();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_NOT_FOUND');
    }
  });

  it('session owned by another client → NOT_AUTHORIZED', async () => {
    mockSessionDb({
      sessionContainer: {
        findUnique: async () =>
          makeRow({ client_account_id: 'cli_other_000000000000001' }),
      },
    });
    const result = await runOp();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_NOT_AUTHORIZED');
    }
  });

  it('already SHARED → INVALID_STATE(SHARE)', async () => {
    mockSessionDb({
      sessionContainer: {
        findUnique: async () =>
          makeRow({
            lifecycle_state: SessionContainerLifecycleStateValue.SHARED,
          }),
      },
    });
    const result = await runOp();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_INVALID_STATE');
      if (result.error.type === 'SESSION_CONTAINER_INVALID_STATE') {
        expect(result.error.attemptedAction).toBe('SHARE');
      }
    }
  });

  it('no stylist assigned yet (empty draft) → SESSION_CONTAINER_EMPTY', async () => {
    mockSessionDb({
      sessionContainer: {
        findUnique: async () => makeRow({ stylist_account_id: null }),
      },
    });
    const result = await runOp();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_EMPTY');
    }
  });

  it('no ACTIVE pairing → NOT_PAIRED, transaction never starts', async () => {
    const { updateMany } = installShareDb({ pair: null });
    const result = await runOp();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_NOT_PAIRED');
      if (result.error.type === 'SESSION_CONTAINER_NOT_PAIRED') {
        expect(result.error.stylistAccountId).toBe(STYLIST_ACCOUNT_ID);
      }
    }
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('shareSessionContainer_IO — in-TX guards + TTL write', () => {
  it('zero photos → SESSION_CONTAINER_EMPTY, no transition', async () => {
    const { updateMany } = installShareDb({ photoCount: 0 });
    const result = await runOp();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_EMPTY');
    }
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('SC-1 active-slot cap hit → MAX_ACTIVE_EXCEEDED; the count is TTL-filtered (SC-4)', async () => {
    const count = makeCount([3], [0]);
    const { updateMany } = installShareDb({ count });
    const result = await runOp();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_MAX_ACTIVE_EXCEEDED');
      if (result.error.type === 'SESSION_CONTAINER_MAX_ACTIVE_EXCEEDED') {
        expect(result.error.currentCount).toBe(3);
        expect(result.error.limit).toBe(
          SESSION_CONTAINER_CONFIG.SESSION_MAX_ACTIVE_PER_CLIENT
        );
      }
    }
    expect(updateMany).not.toHaveBeenCalled();
    // The active-slot WHERE mirrors the read-side expiry filter: expired-but-unswept
    // sessions (SHARED/ACTIVE with expires_at <= now) must NOT occupy a slot.
    const activeArg = count.mock.calls[0]?.[0] as unknown as {
      where: {
        client_account_id: string;
        lifecycle_state: { in: string[] };
        OR: [{ expires_at: null }, { expires_at: { gt: Date } }];
      };
    };
    expect(activeArg.where.client_account_id).toBe(CLIENT_ACCOUNT_ID);
    expect(activeArg.where.OR[0]).toEqual({ expires_at: null });
    expect(activeArg.where.OR[1]?.expires_at.gt).toBeInstanceOf(Date);
  });

  it("the sender's hourly brake: she already sent this stylist the allowed number → SHARE_QUOTA_EXCEEDED", async () => {
    const count = makeCount([0], [SESSION_SHARES_PER_PAIR_PER_HOUR]);
    const { updateMany } = installShareDb({ count });
    const result = await runOp();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_SHARE_QUOTA_EXCEEDED');
      if (result.error.type === 'SESSION_CONTAINER_SHARE_QUOTA_EXCEEDED') {
        expect(result.error.stylistAccountId).toBe(STYLIST_ACCOUNT_ID);
        expect(result.error.currentCount).toBe(
          SESSION_SHARES_PER_PAIR_PER_HOUR
        );
        expect(result.error.limit).toBe(SESSION_SHARES_PER_PAIR_PER_HOUR);
      }
    }
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('the hourly count is scoped to THIS client and THIS stylist: nobody else pays for a flood', async () => {
    const count = makeCount([0], [0]);
    installShareDb({ count });
    await runOp();
    const shareArgs = count.mock.calls
      .map(c => c[0] as unknown as { where: Record<string, unknown> })
      .filter(c => 'shared_at' in c.where);
    // One read, before the write; no re-count after it (one live session per
    // pair makes a concurrent second share structurally impossible).
    expect(shareArgs).toHaveLength(1);
    expect(shareArgs[0]?.where.client_account_id).toBe(CLIENT_ACCOUNT_ID);
    expect(shareArgs[0]?.where.stylist_account_id).toBe(STYLIST_ACCOUNT_ID);
    const window = shareArgs[0]?.where.shared_at as { gte: Date };
    expect(Date.now() - window.gte.getTime()).toBeGreaterThanOrEqual(
      TIME.MS_PER_HOUR - 1_000
    );
    expect(Date.now() - window.gte.getTime()).toBeLessThanOrEqual(
      TIME.MS_PER_HOUR + 1_000
    );
  });

  it('one below the brake still goes through, and the plan of the stylist is never read', async () => {
    const count = makeCount([0], [SESSION_SHARES_PER_PAIR_PER_HOUR - 1]);
    const { updateMany, readStylistPlan } = installShareDb({ count });
    const result = await runOp();
    expect(result.success).toBe(true);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(readStylistPlan).not.toHaveBeenCalled();
  });

  it('happy path: atomic CAS transition writes SHARED + shared_at + expires_at = shared_at + SESSION_EXPIRY_DAYS (THE TTL write value)', async () => {
    const { updateMany } = installShareDb({});
    const result = await runOp();

    expect(result.success).toBe(true);
    expect(updateMany).toHaveBeenCalledTimes(1);
    const arg = updateMany.mock.calls[0]?.[0] as unknown as {
      where: { id: string; lifecycle_state: { in: string[] } };
      data: { lifecycle_state: string; shared_at: Date; expires_at: Date };
    };
    // CAS guard: only a DRAFT/READY row may transition (loser matches 0 rows).
    expect(arg.where.id).toBe(SESSION_ID);
    expect(arg.where.lifecycle_state.in).toEqual(
      expect.arrayContaining([
        SessionContainerLifecycleStateValue.DRAFT,
        SessionContainerLifecycleStateValue.READY,
      ])
    );
    expect(arg.data.lifecycle_state).toBe(
      SessionContainerLifecycleStateValue.SHARED
    );
    expect(arg.data.shared_at).toBeInstanceOf(Date);
    const expectedTtlMs =
      SESSION_CONTAINER_CONFIG.SESSION_EXPIRY_DAYS * TIME.MS_PER_DAY;
    expect(arg.data.expires_at.getTime() - arg.data.shared_at.getTime()).toBe(
      expectedTtlMs
    );
  });

  it('CAS loser (updateMany count=0 — concurrent SHARE/CLOSE won) → INVALID_STATE, never a double-share', async () => {
    const { updateMany } = installShareDb({ updateManyCount: 0 });
    const result = await runOp();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_INVALID_STATE');
    }
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('in-TX fresh state no longer shareable (concurrent transition) → INVALID_STATE with the FRESH state', async () => {
    let findUniqueCall = 0;
    mockSessionDb({
      sessionContainer: {
        findUnique: async () => {
          findUniqueCall += 1;
          // Pre-flight sees READY; the in-TX re-fetch sees CLOSED.
          return findUniqueCall === 1
            ? makeRow()
            : makeRow({
                lifecycle_state: SessionContainerLifecycleStateValue.CLOSED,
              });
        },
      },
      clientStylistPair: { findFirst: async () => ({ id: 'pair_1' }) },
    });

    const result = await runOp();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_INVALID_STATE');
      if (result.error.type === 'SESSION_CONTAINER_INVALID_STATE') {
        expect(result.error.currentState).toBe(
          SessionContainerLifecycleStateValue.CLOSED
        );
      }
    }
  });

  it('POST-UPDATE VERIFY active race → MAX_ACTIVE_EXCEEDED (typed, not an unmapped 500)', async () => {
    // Pre-write active count passes (0), post-write verify sees over-cap (4).
    const count = makeCount([0, 4], [0, 0]);
    installShareDb({ count });
    const result = await runOp();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_MAX_ACTIVE_EXCEEDED');
    }
  });
});
