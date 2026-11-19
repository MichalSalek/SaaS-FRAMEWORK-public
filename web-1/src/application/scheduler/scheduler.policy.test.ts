import { describe, expect, it } from 'vitest';
import {
  decideTick,
  detectSecondInstance,
  lateDeadlineMs,
  nextTickWindowStart,
  toJobStates,
} from './scheduler.policy';
import {
  HOUR,
  MINUTE,
  NOON,
  makeJobs,
  row,
} from '../../test-utils/scheduler.fixtures';

describe('scheduler policy', () => {
  it('moves a deadline that falls in quiet hours to 09:00 UTC', () => {
    expect(nextTickWindowStart(Date.parse('2026-10-23T22:00:00Z'))).toBe(
      Date.parse('2026-10-24T09:00:00Z')
    );
    expect(nextTickWindowStart(Date.parse('2026-10-24T03:00:00Z'))).toBe(
      Date.parse('2026-10-24T09:00:00Z')
    );
    expect(nextTickWindowStart(NOON)).toBe(NOON);
  });

  it('gives a non-waking job the wake floor before it is late', () => {
    const { jobs } = makeJobs();
    const [daily, , janitor] = jobs;
    if (daily === undefined || janitor === undefined) {
      throw new Error('jobs');
    }
    expect(lateDeadlineMs(daily, NOON, 6 * HOUR)).toBe(NOON + HOUR);
    expect(lateDeadlineMs(janitor, NOON, 6 * HOUR)).toBe(
      Date.parse('2026-10-23T19:00:00Z')
    );
  });

  it('wakes the database on a cold cache in daytime, never in quiet hours', () => {
    const { jobs } = makeJobs();
    expect(
      decideTick({
        jobs,
        states: null,
        nowMs: NOON,
        lastRoundFinishedAtMs: 0,
        consecutiveFailedRounds: 0,
      }).wake
    ).toBe(true);
    expect(
      decideTick({
        jobs,
        states: null,
        nowMs: Date.parse('2026-10-23T23:00:00Z'),
        lastRoundFinishedAtMs: 0,
        consecutiveFailedRounds: 0,
      }).wake
    ).toBe(false);
  });

  it('does not wake the database when only a non-waking job is due', () => {
    const { jobs } = makeJobs();
    const states = toJobStates([
      row('pairing-cleanup', NOON + 10 * HOUR),
      row('session-container-expiry', NOON + 5 * HOUR),
      row('stripe-event-janitor', NOON - HOUR),
    ]);
    expect(
      decideTick({
        jobs,
        states,
        nowMs: NOON,
        lastRoundFinishedAtMs: NOON,
        consecutiveFailedRounds: 0,
      }).wake
    ).toBe(false);
  });

  it('wakes for a waking job due within one tick period', () => {
    const { jobs } = makeJobs();
    const states = toJobStates([
      row('pairing-cleanup', NOON + 10 * HOUR),
      row('session-container-expiry', NOON + 20 * MINUTE),
      row('stripe-event-janitor', NOON - HOUR),
    ]);
    expect(
      decideTick({
        jobs,
        states,
        nowMs: NOON,
        lastRoundFinishedAtMs: NOON,
        consecutiveFailedRounds: 0,
      }).wake
    ).toBe(true);
  });

  it('alarms only when a round already ran past the deadline and the job is still late', () => {
    const { jobs } = makeJobs();
    const states = toJobStates([
      row('pairing-cleanup', NOON - 3 * HOUR),
      row('session-container-expiry', NOON + HOUR),
      row('stripe-event-janitor', NOON),
    ]);
    // The clock was away (no round since before the deadline): recovering, no alarm yet.
    expect(
      decideTick({
        jobs,
        states,
        nowMs: NOON,
        lastRoundFinishedAtMs: NOON - 4 * HOUR,
        consecutiveFailedRounds: 0,
      }).alarm
    ).toEqual([]);
    // A round ran after the deadline and the job is still due: the work does not get done.
    expect(
      decideTick({
        jobs,
        states,
        nowMs: NOON,
        lastRoundFinishedAtMs: NOON - MINUTE,
        consecutiveFailedRounds: 0,
      }).alarm
    ).toEqual(['pairing-cleanup']);
  });

  it('tells a deploy overlap from a second instance', () => {
    const own = 'b:2:' + String(NOON);
    const overlap = toJobStates([
      {
        ...row('pairing-cleanup', NOON),
        last_instance: 'a:1:0',
        last_completed_at_ms: NOON + 2 * MINUTE,
      },
    ]);
    const second = toJobStates([
      {
        ...row('pairing-cleanup', NOON),
        last_instance: 'a:1:0',
        last_completed_at_ms: NOON + HOUR,
      },
    ]);
    expect(
      detectSecondInstance({
        states: overlap,
        ownInstance: own,
        ownBootMs: NOON,
      })
    ).toBeNull();
    expect(
      detectSecondInstance({
        states: second,
        ownInstance: own,
        ownBootMs: NOON,
      })
    ).toBe('a:1:0');
  });
});
