import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyDebuggerRuntimeConfig,
  debuggerStates,
  initializeDebuggerStateFromDB,
} from './debugger.state';

describe('debugger runtime config without DB polling', () => {
  afterEach(() => {
    vi.useRealTimers();
    applyDebuggerRuntimeConfig('VERBOSE_LOG_MODE', 'false');
    applyDebuggerRuntimeConfig('API_TIMING_DEBUG_MODE', 'false');
  });

  it('reads both flags once and never schedules another database read', async () => {
    vi.useFakeTimers();
    const read = vi.fn(async (key: string) =>
      key === 'VERBOSE_LOG_MODE' ? 'true' : 'false'
    );

    await initializeDebuggerStateFromDB(read);
    await vi.advanceTimersByTimeAsync(30 * 60 * 1_000);

    expect(read).toHaveBeenCalledTimes(2);
    expect(debuggerStates.isEnabledDebugMode).toBe(true);
    expect(debuggerStates.isEnabledApiTimingDebugger).toBe(false);
  });

  it('applies an admin update immediately in the current process', () => {
    applyDebuggerRuntimeConfig('API_TIMING_DEBUG_MODE', 'true');
    expect(debuggerStates.isEnabledApiTimingDebugger).toBe(true);
  });
});

describe('debugger state across Next.js module copies', () => {
  it('shares boot settings and later admin updates with the endpoint bundle', async () => {
    vi.resetModules();
    const boot = await import('./debugger.state');
    await boot.initializeDebuggerStateFromDB(async () => 'false');
    vi.resetModules();
    const endpoint = await import('./debugger.state');
    expect(endpoint.debuggerStates).toBe(boot.debuggerStates);
    endpoint.applyDebuggerRuntimeConfig('VERBOSE_LOG_MODE', 'true');
    expect(boot.debuggerStates.isEnabledDebugMode).toBe(true);
    boot.applyDebuggerRuntimeConfig('VERBOSE_LOG_MODE', 'false');
    expect(endpoint.debuggerStates.isEnabledDebugMode).toBe(false);
    endpoint.applyDebuggerRuntimeConfig('API_TIMING_DEBUG_MODE', 'true');
    expect(boot.debuggerStates.isEnabledApiTimingDebugger).toBe(true);
    boot.applyDebuggerRuntimeConfig('API_TIMING_DEBUG_MODE', 'false');
  });
});
