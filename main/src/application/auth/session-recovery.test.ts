import { describe, expect, it } from 'vitest';
import {
  needsSessionRecovery,
  sessionRecoveryDelayMs,
  type SessionRecoveryState,
} from './session-recovery';

const stuck: SessionRecoveryState = {
  hasToken: true,
  hasSession: false,
  isFetching: false,
  isHeldByLoginFlow: false,
};

describe('needsSessionRecovery', () => {
  it('asks again when a token is stored and the session came back empty', () => {
    expect(needsSessionRecovery(stuck)).toBe(true);
  });

  it('leaves a logged-out visitor alone', () => {
    expect(needsSessionRecovery({ ...stuck, hasToken: false })).toBe(false);
  });

  it('does nothing once the session is there', () => {
    expect(needsSessionRecovery({ ...stuck, hasSession: true })).toBe(false);
  });

  it('waits for a request that is already in flight', () => {
    expect(needsSessionRecovery({ ...stuck, isFetching: true })).toBe(false);
  });

  it('stays out of the way of a login flow that owns the session', () => {
    expect(needsSessionRecovery({ ...stuck, isHeldByLoginFlow: true })).toBe(
      false
    );
  });
});

describe('sessionRecoveryDelayMs', () => {
  it('grows from attempt to attempt and then ends', () => {
    const delays: number[] = [];
    for (let attempt = 0; ; attempt += 1) {
      const delay = sessionRecoveryDelayMs(attempt);
      if (delay === null) {
        break;
      }
      delays.push(delay);
    }
    expect(delays.length).toBeGreaterThanOrEqual(3);
    expect([...delays].sort((a, b) => a - b)).toEqual(delays);
    expect(delays[0]).toBeLessThanOrEqual(1_000);
  });
});
