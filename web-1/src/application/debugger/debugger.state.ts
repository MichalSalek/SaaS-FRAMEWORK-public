import { ENV_VARS } from '@app/environment/environment.config';
import type { RuntimeConfigKey } from '@kernel/domain/admin/runtime-config.config';

type DebuggerState = {
  isEnabledDebugMode: boolean;
  isEnabledDBLeaksDebugger: boolean;
  isEnabledApiTimingDebugger: boolean;
};

const globalScope = globalThis as typeof globalThis & {
  __nailfolioDebuggerState?: DebuggerState;
};

// DECISION: Next bundles instrumentation and API routes separately. Share the runtime flags
// across those module copies so the boot read and admin writes reach every logger.
// Test: debugger.state.test.ts (module copies in one process; not multiple processes).
export const debuggerStates: DebuggerState =
  (globalScope.__nailfolioDebuggerState ??= {
    isEnabledDebugMode: ENV_VARS.INIT_BACKEND_DEBUG_MODE,
    isEnabledDBLeaksDebugger: ENV_VARS.INIT_BACKEND_DEBUG_DB_MODE,
    // DECISION: api-timing debug is NOT always-on on staging (staging mirrors prod). It starts false,
    // then syncs from the DB runtime config (admin-toggleable without a deploy), like prod. Loaded
    // once at boot and updated event-driven by admin updates in the same process; false when the DB
    // is unavailable (fail-closed).
    isEnabledApiTimingDebugger: false,
  });

const VERBOSE_KEY: RuntimeConfigKey = 'VERBOSE_LOG_MODE';
const API_TIMING_KEY: RuntimeConfigKey = 'API_TIMING_DEBUG_MODE';

/**
 * Apply a persisted debugger runtime-config value to the current process.
 *
 * DECISION: runtime debugger config is held in process state. It is loaded once at boot and every
 * admin write updates this in-memory state synchronously. We do NOT poll Postgres: a 5-minute poll
 * prevents Neon scale-to-zero while the API process is intentionally kept warm. For a multi-instance
 * deployment, replace this seam with explicit cross-instance delivery (Redis/pub-sub or controlled
 * restart), never a permanent DB keepalive loop.
 */
export const applyDebuggerRuntimeConfig = (
  key: RuntimeConfigKey,
  value: string
): void => {
  if (key === VERBOSE_KEY) {
    debuggerStates.isEnabledDebugMode = value === 'true';
  } else if (key === API_TIMING_KEY) {
    debuggerStates.isEnabledApiTimingDebugger = value === 'true';
  }
};

/** Load debugger flags once during boot. Never starts timers. */
export const initializeDebuggerStateFromDB = async (
  readConfigValue: (key: string, defaultValue: string) => Promise<string>
): Promise<void> => {
  try {
    const [verboseValue, apiTimingValue] = await Promise.all([
      readConfigValue(VERBOSE_KEY, 'false'),
      readConfigValue(API_TIMING_KEY, 'false'),
    ]);
    applyDebuggerRuntimeConfig(VERBOSE_KEY, verboseValue);
    applyDebuggerRuntimeConfig(API_TIMING_KEY, apiTimingValue);
  } catch {
    // DB unavailable — keep safe boot defaults / env-provided verbose state.
  }
};
