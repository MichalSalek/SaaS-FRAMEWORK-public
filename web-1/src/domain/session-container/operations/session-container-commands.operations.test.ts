/**
 * SessionContainer CREATE unit tests — createSessionContainer_IO (domain-unit).
 *
 * Drives DB_CLIENT.use through the global setup proxy (mockDb), calling the op
 * DIRECTLY. Covers the branches the integration layer does not:
 *   - pairing gate (NOT_PAIRED) fires BEFORE any transaction write,
 *   - anonymous create (no stylist) skips the pairing + existing-pair lookups,
 *   - pair-invariant idempotency (existing non-terminal session returned as-is),
 *   - SC-1 per-client cap WHERE shape incl. the SC-4 TTL filter (expired-but-unswept
 *     sessions must NOT occupy a slot — the write-path mirror of the s22 TTL work),
 *   - P2002 race: live winner returned idempotently; terminal winner → bounded
 *     retry; exhaustion → honest DATABASE_ERROR (never a 500-shaped throw).
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { createSessionContainer_IO } from './session-container-commands.operations';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';

const CLIENT_USER_ID = 'usr_client_00000000000001';
const CLIENT_ACCOUNT_ID = 'cli_test_0000000000000001';
const STYLIST_ACCOUNT_ID = 'acc_stylist_0000000000001';
const SESSION_ID = 'sess_created_000000000001';

const makeCreatedRow = (overrides: Record<string, unknown> = {}) => ({
  id: SESSION_ID,
  client_account_id: CLIENT_ACCOUNT_ID,
  stylist_account_id: STYLIST_ACCOUNT_ID,
  name: null,
  lifecycle_state: SessionContainerLifecycleStateValue.DRAFT,
  stylist_note: null,
  client_note: null,
  shared_at: null,
  expires_at: null,
  closed_at: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

type CountArg = {
  where: {
    client_account_id: string;
    lifecycle_state: { in: string[] };
    OR: [{ expires_at: null }, { expires_at: { gt: Date } }];
  };
};

describe('createSessionContainer_IO', () => {
  it('stylist given but pairing not ACTIVE → SESSION_CONTAINER_NOT_PAIRED, zero writes', async () => {
    const create = vi.fn(async () => makeCreatedRow());
    const count = vi.fn(async () => 0);
    mockDb({
      clientStylistPair: { findFirst: async () => null },
      sessionContainer: { create, count, findFirst: async () => null },
    });

    const result = await createSessionContainer_IO({
      client_user_id: CLIENT_USER_ID,
      client_account_id: CLIENT_ACCOUNT_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_NOT_PAIRED');
      if (result.error.type === 'SESSION_CONTAINER_NOT_PAIRED') {
        expect(result.error.clientUserId).toBe(CLIENT_USER_ID);
        expect(result.error.stylistAccountId).toBe(STYLIST_ACCOUNT_ID);
      }
    }
    // The gate fires BEFORE the transaction — no count, no create.
    expect(count).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('happy path with stylist → DRAFT created with scoped data; cap count carries the SC-4 TTL filter', async () => {
    const create = vi.fn(async (_arg: unknown) => makeCreatedRow());
    const count = vi.fn(async (_arg: unknown) => 0);
    mockDb({
      clientStylistPair: { findFirst: async () => ({ id: 'pair_1' }) },
      sessionContainer: {
        findFirst: async () => null, // no existing non-terminal session for this pair
        count,
        create,
      },
    });

    const result = await createSessionContainer_IO({
      client_user_id: CLIENT_USER_ID,
      client_account_id: CLIENT_ACCOUNT_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      name: 'Wesele kuzynki',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lifecycleState).toBe(
        SessionContainerLifecycleStateValue.DRAFT
      );
      expect(result.data.photoCount).toBe(0);
    }

    // Create payload: scoped to THIS client, DRAFT, name passed through.
    const createArg = create.mock.calls[0]?.[0] as unknown as {
      data: {
        client_account_id: string;
        stylist_account_id: string | null;
        name: string | null;
        lifecycle_state: string;
      };
    };
    expect(createArg.data.client_account_id).toBe(CLIENT_ACCOUNT_ID);
    expect(createArg.data.stylist_account_id).toBe(STYLIST_ACCOUNT_ID);
    expect(createArg.data.name).toBe('Wesele kuzynki');
    expect(createArg.data.lifecycle_state).toBe(
      SessionContainerLifecycleStateValue.DRAFT
    );

    // SC-1 cap counts THIS client's live sessions; SC-4: expired-but-unswept rows
    // (expires_at <= now, lifecycle still SHARED/ACTIVE) must not inflate the count.
    const countArg = count.mock.calls[0]?.[0] as unknown as CountArg;
    expect(countArg.where.client_account_id).toBe(CLIENT_ACCOUNT_ID);
    expect(countArg.where.lifecycle_state.in).toEqual(
      expect.arrayContaining([
        SessionContainerLifecycleStateValue.SHARED,
        SessionContainerLifecycleStateValue.ACTIVE,
      ])
    );
    expect(countArg.where.OR[0]).toEqual({ expires_at: null });
    expect(countArg.where.OR[1]?.expires_at.gt).toBeInstanceOf(Date);
  });

  it('anonymous create (no stylist) skips pairing + existing-pair lookup, still enforces the cap', async () => {
    const findFirst = vi.fn(async () => null);
    const create = vi.fn(async (_arg: unknown) =>
      makeCreatedRow({ stylist_account_id: null })
    );
    // clientStylistPair NOT mocked — the fail-loud proxy would throw if the op
    // touched it, proving the pairing check is skipped for anonymous drafts.
    mockDb({
      sessionContainer: { findFirst, count: async () => 0, create },
    });

    const result = await createSessionContainer_IO({
      client_user_id: CLIENT_USER_ID,
      client_account_id: CLIENT_ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    expect(findFirst).not.toHaveBeenCalled();
    const createArg = create.mock.calls[0]?.[0] as unknown as {
      data: { stylist_account_id: string | null; name: string | null };
    };
    expect(createArg.data.stylist_account_id).toBeNull();
    expect(createArg.data.name).toBeNull();
  });

  it('pair invariant: an existing non-terminal session for (client, stylist) is returned idempotently — no create', async () => {
    const existing = makeCreatedRow({
      id: 'sess_existing_00000000001',
      lifecycle_state: SessionContainerLifecycleStateValue.SHARED,
    });
    const findFirst = vi.fn(async (_arg: unknown) => existing);
    const create = vi.fn(async () => makeCreatedRow());
    mockDb({
      clientStylistPair: { findFirst: async () => ({ id: 'pair_1' }) },
      sessionContainer: { findFirst, create, count: async () => 0 },
      sessionContainerPhoto: { count: async () => 4 },
    });

    const result = await createSessionContainer_IO({
      client_user_id: CLIENT_USER_ID,
      client_account_id: CLIENT_ACCOUNT_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('sess_existing_00000000001');
      expect(result.data.photoCount).toBe(4);
    }
    expect(create).not.toHaveBeenCalled();

    // Lookup is scoped to the pair AND excludes terminal states only.
    const findArg = findFirst.mock.calls[0]?.[0] as unknown as {
      where: {
        client_account_id: string;
        stylist_account_id: string;
        lifecycle_state: { notIn: string[] };
      };
    };
    expect(findArg.where.client_account_id).toBe(CLIENT_ACCOUNT_ID);
    expect(findArg.where.stylist_account_id).toBe(STYLIST_ACCOUNT_ID);
    expect(findArg.where.lifecycle_state.notIn).toEqual(
      expect.arrayContaining([
        SessionContainerLifecycleStateValue.CLOSED,
        SessionContainerLifecycleStateValue.EXPIRED,
      ])
    );
  });

  it('SC-1 cap hit (3 live sessions) → MAX_ACTIVE_EXCEEDED, no create', async () => {
    const create = vi.fn(async () => makeCreatedRow());
    mockDb({
      clientStylistPair: { findFirst: async () => ({ id: 'pair_1' }) },
      sessionContainer: {
        findFirst: async () => null,
        count: async () => 3,
        create,
      },
    });

    const result = await createSessionContainer_IO({
      client_user_id: CLIENT_USER_ID,
      client_account_id: CLIENT_ACCOUNT_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_MAX_ACTIVE_EXCEEDED');
      if (result.error.type === 'SESSION_CONTAINER_MAX_ACTIVE_EXCEEDED') {
        expect(result.error.clientAccountId).toBe(CLIENT_ACCOUNT_ID);
        expect(result.error.currentCount).toBe(3);
        expect(result.error.limit).toBe(3);
      }
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('P2002 race with a LIVE winner → winner returned idempotently (no 500)', async () => {
    let findFirstCall = 0;
    const winner = makeCreatedRow({ id: 'sess_winner_0000000000001' });
    const create = vi.fn(async () => {
      throw { code: 'P2002' };
    });
    mockDb({
      clientStylistPair: { findFirst: async () => ({ id: 'pair_1' }) },
      sessionContainer: {
        // Call 1 (in-TX existing-pair check) → null so create is attempted;
        // call 2 (post-P2002 winner re-fetch) → the concurrent winner.
        findFirst: async () => {
          findFirstCall += 1;
          return findFirstCall === 1 ? null : winner;
        },
        count: async () => 0,
        create,
      },
      sessionContainerPhoto: { count: async () => 2 },
    });

    const result = await createSessionContainer_IO({
      client_user_id: CLIENT_USER_ID,
      client_account_id: CLIENT_ACCOUNT_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('sess_winner_0000000000001');
      expect(result.data.photoCount).toBe(2);
    }
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('P2002 race, winner already terminal (re-fetch null) → bounded retry succeeds on attempt 2', async () => {
    let createCall = 0;
    const create = vi.fn(async () => {
      createCall += 1;
      if (createCall === 1) {
        throw { code: 'P2002' };
      }
      return makeCreatedRow();
    });
    mockDb({
      clientStylistPair: { findFirst: async () => ({ id: 'pair_1' }) },
      sessionContainer: {
        findFirst: async () => null, // no existing pair AND no live winner
        count: async () => 0,
        create,
      },
    });

    const result = await createSessionContainer_IO({
      client_user_id: CLIENT_USER_ID,
      client_account_id: CLIENT_ACCOUNT_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('P2002 storm — retries exhausted (3 attempts) → honest DATABASE_ERROR', async () => {
    const create = vi.fn(async () => {
      throw { code: 'P2002' };
    });
    mockDb({
      clientStylistPair: { findFirst: async () => ({ id: 'pair_1' }) },
      sessionContainer: {
        findFirst: async () => null,
        count: async () => 0,
        create,
      },
    });

    const result = await createSessionContainer_IO({
      client_user_id: CLIENT_USER_ID,
      client_account_id: CLIENT_ACCOUNT_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('DATABASE_ERROR');
    }
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('non-P2002 transaction error → DATABASE_ERROR without retry', async () => {
    const create = vi.fn(async () => {
      throw new Error('connection reset');
    });
    mockDb({
      clientStylistPair: { findFirst: async () => ({ id: 'pair_1' }) },
      sessionContainer: {
        findFirst: async () => null,
        count: async () => 0,
        create,
      },
    });

    const result = await createSessionContainer_IO({
      client_user_id: CLIENT_USER_ID,
      client_account_id: CLIENT_ACCOUNT_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('DATABASE_ERROR');
    }
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('P2003 (stylist account vanished after the pairing check) → SESSION_CONTAINER_NOT_PAIRED, no retry', async () => {
    const create = vi.fn(async () => {
      throw { code: 'P2003' };
    });
    mockDb({
      clientStylistPair: { findFirst: async () => ({ id: 'pair_1' }) },
      sessionContainer: {
        findFirst: async () => null,
        count: async () => 0,
        create,
      },
    });

    const result = await createSessionContainer_IO({
      client_user_id: CLIENT_USER_ID,
      client_account_id: CLIENT_ACCOUNT_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_NOT_PAIRED');
    }
    expect(create).toHaveBeenCalledTimes(1);
  });
});
