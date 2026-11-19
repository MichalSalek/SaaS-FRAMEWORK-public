// main/src/application/error-debugger/client-verbose.state.ts
// Client-side mirror of the VERBOSE_LOG_MODE runtime-config flag — the FRONTEND
// half of the ONE end-to-end verbose-logging switch (see docs/LOGGING.md).
//
// The public runtime-config query (useMaintenanceMessage, mounted app-wide via the
// MaintenanceBanner in App + Public layouts) publishes the fetched value here on
// every fetch. reportIssueFrontend and __debuggerGate read it SYNCHRONOUSLY — they
// run outside React, so a module-level ref is the reliable channel (this is the
// client analogue of the backend's debuggerStates.isEnabledDebugMode, fed from the
// SAME VERBOSE_LOG_MODE key). Defaults false (fail-closed) until the first
// public-config fetch resolves, and resets to false on fetch error.

let verboseLogEnabled = false;

/** True when admin has VERBOSE_LOG_MODE on (info-level client logs should ship). */
export const getClientVerboseLog = (): boolean => verboseLogEnabled;

/** Called by the public-runtime-config fetch on every resolve (fail-closed to false). */
export const setClientVerboseLog = (enabled: boolean): void => {
  verboseLogEnabled = enabled;
};
