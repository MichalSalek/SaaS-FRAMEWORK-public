import { describe, it, expect, afterEach } from 'vitest';
import {
  LockOrderViolationError,
  configureLockOrderAssertions,
  heldLocksOf,
  recordLockAcquisition,
  resetLockOrderTracking,
  sortLockTargets,
} from './lock-order';

afterEach(() => {
  configureLockOrderAssertions(true);
  resetLockOrderTracking();
});

describe('sortLockTargets', () => {
  it('sorts by table rank first, then id', () => {
    const sorted = sortLockTargets([
      { table: 'SupportThread', id: 'a' },
      { table: 'StylistAccount', id: 'b' },
      { table: 'User', id: 'z' },
      { table: 'StylistAccount', id: 'a' },
      { table: 'User', id: 'm' },
    ]);
    expect(sorted.map(t => `${t.table}:${t.id}`)).toEqual([
      'User:m',
      'User:z',
      'StylistAccount:a',
      'StylistAccount:b',
      'SupportThread:a',
    ]);
  });

  it('is independent of the input order (every writer gets the same sequence)', () => {
    const targets = [
      { table: 'StylistAccount' as const, id: 'acc_2' },
      { table: 'User' as const, id: 'usr_1' },
      { table: 'StylistAccount' as const, id: 'acc_1' },
    ];
    expect(sortLockTargets(targets)).toEqual(
      sortLockTargets([...targets].reverse())
    );
  });

  it('collapses duplicates to the strongest mode and defaults to FOR UPDATE', () => {
    const sorted = sortLockTargets([
      { table: 'User', id: 'u', mode: 'FOR KEY SHARE' },
      { table: 'User', id: 'u', mode: 'FOR NO KEY UPDATE' },
      { table: 'StylistAccount', id: 's' },
    ]);
    expect(sorted).toEqual([
      { table: 'User', id: 'u', mode: 'FOR NO KEY UPDATE' },
      { table: 'StylistAccount', id: 's', mode: 'FOR UPDATE' },
    ]);
  });
});

describe('recordLockAcquisition (dev/test checker)', () => {
  it('accepts ascending rank, then ascending id', () => {
    const tx = {};
    recordLockAcquisition(tx, 'User', 'u1', 'FOR UPDATE');
    recordLockAcquisition(tx, 'StylistAccount', 'a1', 'FOR UPDATE');
    recordLockAcquisition(tx, 'StylistAccount', 'a2', 'FOR UPDATE');
    recordLockAcquisition(tx, 'SupportThread', 't', 'FOR UPDATE');
    expect([...heldLocksOf(tx).keys()]).toEqual([
      'User:u1',
      'StylistAccount:a1',
      'StylistAccount:a2',
      'SupportThread:t',
    ]);
  });

  it('rejects a lower rank after a higher one (the ABBA shape)', () => {
    const tx = {};
    recordLockAcquisition(tx, 'StylistAccount', 'a', 'FOR UPDATE');
    expect(() =>
      recordLockAcquisition(tx, 'User', 'u', 'FOR KEY SHARE')
    ).toThrow(LockOrderViolationError);
  });

  it('rejects a lower id of the same table after a higher one', () => {
    const tx = {};
    recordLockAcquisition(tx, 'User', 'u2', 'FOR UPDATE');
    expect(() => recordLockAcquisition(tx, 'User', 'u1', 'FOR UPDATE')).toThrow(
      /Lock order violation/
    );
  });

  it('allows re-locking a held row in the same or a weaker mode (re-entrant helpers)', () => {
    const tx = {};
    recordLockAcquisition(tx, 'User', 'u', 'FOR UPDATE');
    recordLockAcquisition(tx, 'StylistAccount', 'a', 'FOR UPDATE');
    expect(() => {
      recordLockAcquisition(tx, 'User', 'u', 'FOR UPDATE');
      recordLockAcquisition(tx, 'User', 'u', 'FOR KEY SHARE');
    }).not.toThrow();
  });

  it('rejects upgrading a shared lock (two KEY SHARE holders upgrading deadlock)', () => {
    const tx = {};
    recordLockAcquisition(tx, 'User', 'u', 'FOR KEY SHARE');
    expect(() => recordLockAcquisition(tx, 'User', 'u', 'FOR UPDATE')).toThrow(
      /Lock upgrade/
    );
  });

  it('tracks transactions independently', () => {
    const a = {};
    const b = {};
    recordLockAcquisition(a, 'StylistAccount', 's', 'FOR UPDATE');
    expect(() =>
      recordLockAcquisition(b, 'User', 'u', 'FOR UPDATE')
    ).not.toThrow();
  });

  it('is a no-op while assertions are off (production)', () => {
    configureLockOrderAssertions(false);
    const tx = {};
    recordLockAcquisition(tx, 'SupportThread', 't', 'FOR UPDATE');
    expect(() =>
      recordLockAcquisition(tx, 'User', 'u', 'FOR UPDATE')
    ).not.toThrow();
    expect(heldLocksOf(tx).size).toBe(0);
  });

  it('reset starts every transaction clean (a fake tx reused across tests)', () => {
    const tx = {};
    recordLockAcquisition(tx, 'SupportThread', 't', 'FOR UPDATE');
    resetLockOrderTracking();
    expect(() =>
      recordLockAcquisition(tx, 'User', 'u', 'FOR UPDATE')
    ).not.toThrow();
  });
});
