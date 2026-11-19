/**
 * The shared-session limit counts only sessions with directly connected stylists (rule: kernel session-container.limit.ts).
 * A stylist reached through a salon takes no slot, so a salon client is not capped at three.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  countSessionsTowardSharedLimit,
  isSharedSessionLimitReached,
} from '@kernel/domain/session-container/session-container.limit';
import { SESSION_CONTAINER_CONFIG } from '@kernel/domain/session-container/session-container.config';
import { countSessionsTowardSharedLimit_IO } from './session-container-shared.operations';
import type { Prisma } from '../../../prisma/js-client';

const LIMIT = SESSION_CONTAINER_CONFIG.SESSION_MAX_ACTIVE_PER_CLIENT;

describe('countSessionsTowardSharedLimit (kernel rule)', () => {
  it('counts shared sessions with direct stylists and skips salon stylists and drafts', () => {
    const count = countSessionsTowardSharedLimit(
      [
        { stylistAccountId: 'direct_a', isShared: true },
        { stylistAccountId: 'salon_b', isShared: true },
        { stylistAccountId: 'direct_c', isShared: false },
        { stylistAccountId: null, isShared: true },
      ],
      new Set(['salon_b'])
    );
    expect(count).toBe(2);
  });

  it('reaches the limit exactly at the configured number', () => {
    expect(isSharedSessionLimitReached(LIMIT - 1)).toBe(false);
    expect(isSharedSessionLimitReached(LIMIT)).toBe(true);
  });
});

describe('countSessionsTowardSharedLimit_IO', () => {
  const makeTx = (sessionStylists: string[], salonStylists: string[]) => {
    const sessionFindMany = vi.fn(async (_arg: unknown) =>
      sessionStylists.map(id => ({ stylist_account_id: id }))
    );
    const pairFindMany = vi.fn(async (_arg: unknown) =>
      salonStylists.map(id => ({ stylist_account_id: id }))
    );
    const tx = {
      sessionContainer: { findMany: sessionFindMany },
      clientStylistPair: { findMany: pairFindMany },
    } as unknown as Prisma.TransactionClient;
    return { tx, sessionFindMany, pairFindMany };
  };

  it('a salon client with three direct and two salon sessions is at the limit, not over it', async () => {
    const { tx } = makeTx(['d1', 'd2', 'd3', 's1', 's2'], ['s1', 's2']);
    const count = await countSessionsTowardSharedLimit_IO(
      tx,
      'user_1',
      'acc_1'
    );
    expect(count).toBe(3);
  });

  it('asks only for salon-derived pairs of THIS client and only for the stylists in her sessions', async () => {
    const { tx, pairFindMany } = makeTx(['d1', 's1'], ['s1']);
    await countSessionsTowardSharedLimit_IO(tx, 'user_1', 'acc_1');
    const arg = pairFindMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(arg.where).toEqual({
      client_user_id: 'user_1',
      stylist_account_id: { in: ['d1', 's1'] },
      salon_origin_account_id: { not: null },
    });
  });

  it('skips the pair lookup when she has no shared session', async () => {
    const { tx, pairFindMany } = makeTx([], []);
    expect(await countSessionsTowardSharedLimit_IO(tx, 'user_1', 'acc_1')).toBe(
      0
    );
    expect(pairFindMany).not.toHaveBeenCalled();
  });

  it('reads only live shared sessions of this client (SC-4 expiry filter)', async () => {
    const { tx, sessionFindMany } = makeTx(['d1'], []);
    await countSessionsTowardSharedLimit_IO(tx, 'user_1', 'acc_1');
    const arg = sessionFindMany.mock.calls[0]?.[0] as {
      where: {
        client_account_id: string;
        lifecycle_state: { in: string[] };
        OR: unknown[];
      };
    };
    expect(arg.where.client_account_id).toBe('acc_1');
    expect(arg.where.lifecycle_state.in).toEqual(['SHARED', 'ACTIVE']);
    expect(arg.where.OR).toHaveLength(2);
  });
});
