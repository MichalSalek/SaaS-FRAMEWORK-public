import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The state is module-level, so every test gets a fresh copy of the module.
const loadState = async () => {
  vi.resetModules();
  return import('./email-lifecycle.state');
};

const at = (iso: string) => new Date(iso);

describe('isEmailQuietHours', () => {
  it('is quiet from 21:00 UTC until just before 09:00 UTC', async () => {
    const { isEmailQuietHours } = await loadState();
    expect(isEmailQuietHours(at('2026-09-24T20:59:59Z'))).toBe(false);
    expect(isEmailQuietHours(at('2026-09-24T21:00:00Z'))).toBe(true);
    expect(isEmailQuietHours(at('2026-09-24T03:00:00Z'))).toBe(true);
    expect(isEmailQuietHours(at('2026-09-24T08:59:59Z'))).toBe(true);
    expect(isEmailQuietHours(at('2026-09-24T09:00:00Z'))).toBe(false);
  });
});

describe('isSweepTickDue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at('2026-09-24T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is due on a fresh process outside quiet hours', async () => {
    const { isSweepTickDue } = await loadState();
    expect(isSweepTickDue()).toBe(true);
  });

  it('is never due in quiet hours, even when the sweep is due', async () => {
    const { isSweepTickDue } = await loadState();
    expect(isSweepTickDue(at('2026-09-24T22:00:00Z'))).toBe(false);
  });

  it('waits for the 6 h throttle after a successful sweep', async () => {
    const { isSweepTickDue, updateLastSweepTimestamp } = await loadState();
    updateLastSweepTimestamp();
    expect(isSweepTickDue()).toBe(false);

    vi.setSystemTime(at('2026-09-24T17:59:00Z'));
    expect(isSweepTickDue()).toBe(false);

    vi.setSystemTime(at('2026-09-24T18:01:00Z'));
    expect(isSweepTickDue()).toBe(true);
  });
});
