import { describe, expect, it } from 'vitest';
import { SessionContainerLifecycleStateValue as S } from '@kernel/models/db_models.generated.dto';
import {
  mapOpenSessionsByStylist,
  splitStylistsByOpenSession,
} from './session-stylist-availability';

const session = (
  id: string,
  stylistAccountId: string | null,
  lifecycleState: (typeof S)[keyof typeof S]
) => ({ id, stylistAccountId, lifecycleState });

describe('mapOpenSessionsByStylist', () => {
  it('maps every open session (a draft counts) and marks shared ones', () => {
    const map = mapOpenSessionsByStylist([
      session('s1', 'a', S.DRAFT),
      session('s2', 'b', S.SHARED),
      session('s3', 'c', S.ACTIVE),
      session('s4', 'd', S.READY),
    ]);
    expect([...map.entries()]).toEqual([
      ['a', { id: 's1', shared: false }],
      ['b', { id: 's2', shared: true }],
      ['c', { id: 's3', shared: true }],
      ['d', { id: 's4', shared: false }],
    ]);
  });

  it('skips finished sessions, stylist-less ones and the excluded session', () => {
    const map = mapOpenSessionsByStylist(
      [
        session('closed', 'a', S.CLOSED),
        session('expired', 'b', S.EXPIRED),
        session('none', null, S.DRAFT),
        session('current', 'c', S.READY),
      ],
      'current'
    );
    expect(map.size).toBe(0);
  });

  it('keeps the first open session per stylist', () => {
    const map = mapOpenSessionsByStylist([
      session('first', 'a', S.SHARED),
      session('second', 'a', S.DRAFT),
    ]);
    expect(map.get('a')).toEqual({ id: 'first', shared: true });
  });
});

describe('splitStylistsByOpenSession', () => {
  const pairs = [
    { stylistAccountId: 'a', name: 'Ania' },
    { stylistAccountId: 'b', name: 'Basia' },
    { stylistAccountId: 'c', name: 'Celina' },
  ];

  it('a stylist with an open session stays visible, with the way into that session', () => {
    const { available, withOpenSession } = splitStylistsByOpenSession(
      pairs,
      mapOpenSessionsByStylist([session('open-b', 'b', S.DRAFT)], 'current')
    );
    expect(available.map(p => p.stylistAccountId)).toEqual(['a', 'c']);
    expect(withOpenSession).toEqual([
      { stylist: pairs[1], sessionId: 'open-b' },
    ]);
  });

  it('without known sessions every stylist is available', () => {
    const { available, withOpenSession } = splitStylistsByOpenSession(
      pairs,
      new Map()
    );
    expect(available).toEqual(pairs);
    expect(withOpenSession).toEqual([]);
  });

  it('the session on screen never blocks its own stylist', () => {
    const { available } = splitStylistsByOpenSession(
      pairs,
      mapOpenSessionsByStylist([session('current', 'a', S.DRAFT)], 'current')
    );
    expect(available).toHaveLength(3);
  });
});
