import { describe, it, expect } from 'vitest';
import {
  attentionPairIds,
  orderPairsByAttention,
  resolvePendingSessionByClient,
  resolvePendingSessionClients,
  resolveUnreadByPair,
} from './clientAttention.logic';

/** The dashboard strip's cap, as its widget passes it. */
const STRIP_MAX = 12;

const pair = (id: string, counterpart_inactive = false) => ({
  id,
  counterpart_inactive,
});

const ids = (rows: readonly { id: string }[]) => rows.map(r => r.id);

describe('orderPairsByAttention', () => {
  it('keeps the API order when nobody needs attention (inactive last)', () => {
    const rows = [pair('a'), pair('b', true), pair('c'), pair('d')];
    expect(ids(orderPairsByAttention(rows, new Set()))).toEqual([
      'a',
      'c',
      'd',
      'b',
    ]);
  });

  it('moves clients needing attention to the front, stable within each rank', () => {
    const rows = [pair('a'), pair('b'), pair('c'), pair('d'), pair('e')];
    expect(ids(orderPairsByAttention(rows, new Set(['d', 'b'])))).toEqual([
      'b',
      'd',
      'a',
      'c',
      'e',
    ]);
  });

  it('never lets the cap hide a client needing attention', () => {
    const rows = Array.from({ length: 20 }, (_, i) => pair(`p${i}`));
    const ordered = orderPairsByAttention(
      rows,
      new Set(['p19', 'p15']),
      STRIP_MAX
    );
    expect(ordered).toHaveLength(STRIP_MAX);
    expect(ids(ordered).slice(0, 2)).toEqual(['p15', 'p19']);
    expect(ids(ordered).slice(2)).toEqual(
      Array.from({ length: STRIP_MAX - 2 }, (_, i) => `p${i}`)
    );
  });

  it('does not promote an inactive face even when its pair has unread messages', () => {
    const rows = [pair('a'), pair('b', true)];
    expect(ids(orderPairsByAttention(rows, new Map([['b', 3]])))).toEqual([
      'a',
      'b',
    ]);
  });

  it('keeps every client when no cap is passed (the full list)', () => {
    const rows = Array.from({ length: 20 }, (_, i) => pair(`p${i}`));
    const ordered = orderPairsByAttention(rows, new Set(['p19']));
    expect(ordered).toHaveLength(20);
    expect(ordered[0]?.id).toBe('p19');
  });

  it('does not mutate the input', () => {
    const rows = [pair('a'), pair('b')];
    orderPairsByAttention(rows, new Set(['b']));
    expect(ids(rows)).toEqual(['a', 'b']);
  });
});

describe('resolveUnreadByPair', () => {
  const conversations = [
    { pair_id: 'x', unread_count: 2 },
    { pair_id: 'y', unread_count: 0 },
    { pair_id: 'z', unread_count: 1 },
  ];
  const ok = { isLoading: false, isError: false, hasData: true };

  it('maps only pairs with unread messages', () => {
    expect([...resolveUnreadByPair(conversations, ok)]).toEqual([
      ['x', 2],
      ['z', 1],
    ]);
  });

  it.each([
    ['loading', { ...ok, isLoading: true }],
    ['failed (even over cached data)', { ...ok, isError: true }],
    ['no data cached', { ...ok, hasData: false }],
  ])('returns no attention while the source is %s', (_label, source) => {
    expect(resolveUnreadByPair(conversations, source).size).toBe(0);
  });
});

describe('resolvePendingSessionClients', () => {
  const now = Date.parse('2026-09-25T12:00:00Z');
  const ok = { isLoading: false, isError: false, hasData: true };
  const session = (
    clientUserId: string | null,
    lifecycleState: 'SHARED' | 'ACTIVE' | 'CLOSED' | 'DRAFT',
    expiresAt: string | null
  ) => ({ clientUserId, lifecycleState, expiresAt });

  it('keeps shared or active sessions that have not expired', () => {
    const clients = resolvePendingSessionClients(
      [
        session('u1', 'SHARED', '2026-09-26T00:00:00Z'),
        session('u2', 'ACTIVE', null),
        session('u3', 'SHARED', '2026-09-24T00:00:00Z'),
        session('u4', 'CLOSED', null),
        session(null, 'SHARED', null),
      ],
      ok,
      now
    );
    expect([...clients].sort()).toEqual(['u1', 'u2']);
  });

  it('returns nothing while the source is not trustworthy', () => {
    const sessions = [session('u1', 'SHARED', null)];
    expect(
      resolvePendingSessionClients(sessions, { ...ok, isError: true }, now).size
    ).toBe(0);
    expect(
      resolvePendingSessionClients(sessions, { ...ok, hasData: false }, now)
        .size
    ).toBe(0);
  });

  // The row menu leads straight into the waiting session, so each marked
  // client carries that session's id; an id-less row keeps the mark and only
  // loses the shortcut.
  it('maps each waiting client to the id of her session', () => {
    const byClient = resolvePendingSessionByClient(
      [
        { ...session('u1', 'SHARED', null), id: 's1' },
        { ...session('u1', 'ACTIVE', null), id: 's1-later' },
        session('u2', 'ACTIVE', null),
        { ...session('u3', 'CLOSED', null), id: 's3' },
      ],
      ok,
      now
    );
    expect([...byClient]).toEqual([
      ['u1', 's1'],
      ['u2', ''],
    ]);
  });
});

describe('attentionPairIds', () => {
  it('combines unread messages and waiting sessions per pair', () => {
    const ids = attentionPairIds(
      [
        { id: 'p1', user_id: 'u1', counterpart_inactive: false },
        { id: 'p2', user_id: 'u2', counterpart_inactive: false },
        { id: 'p3', user_id: 'u3', counterpart_inactive: false },
      ],
      {
        unreadByPair: new Map([['p1', 2]]),
        pendingSessionClients: new Set(['u2']),
      }
    );
    expect([...ids].sort()).toEqual(['p1', 'p2']);
  });
});
