import { captureBackendIssue } from './posthog-server';

/**
 * Liveness of the EventLog store. A logger failure cannot report through the logger.
 * DECISION: the sensor sits on `runFlush` (one signal per batch). `reportIssueBackend`
 * only buffers, so a sensor there never sees a rejection. Alarms leave via `console.error`
 * `[LOG_SINK_DOWN]` and PostHog, at powers of ten of one failure streak. State lives on
 * `globalThis` because Next bundles this module twice (see db-availability.state.ts).
 */

type MutableLogSinkState = {
  consecutiveFailures: number;
  totalFailures: number;
  firstFailureAt: string | null;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
};

const globalScope = globalThis as typeof globalThis & {
  __logSinkHealthState?: MutableLogSinkState;
};

const state: MutableLogSinkState = (globalScope.__logSinkHealthState ??= {
  consecutiveFailures: 0,
  totalFailures: 0,
  firstFailureAt: null,
  lastFailureAt: null,
  lastSuccessAt: null,
});

/**
 * True when the streak length is a power of ten. Checked without a logarithm (`Math.log10` on
 * numbers like 1000 can give 2.9999999999999996) by dividing by ten while it divides.
 */
function isAlertThreshold(streak: number): boolean {
  if (streak < 1) {
    return false;
  }
  let value = streak;
  while (value % 10 === 0) {
    value /= 10;
  }
  return value === 1;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

/** A write to the log store succeeded. Closes the streak and reports the recovery. */
export function markLogSinkWriteSucceeded(): void {
  const recoveredStreak = state.consecutiveFailures;
  state.lastSuccessAt = new Date().toISOString();
  state.consecutiveFailures = 0;

  if (recoveredStreak === 0) {
    return;
  }

  const message = `[LOG_SINK_RECOVERED] zapis do składu logów wrócił po ${recoveredStreak} nieudanych próbach`;
  console.error(message);
  captureBackendIssue({
    mode: 'warn',
    namespace: 'ALERT_LOG_SINK',
    message,
    payload: {
      recovered_after_failures: recoveredStreak,
      first_failure_at: state.firstFailureAt,
      total_failures: state.totalFailures,
    },
  });
  state.firstFailureAt = null;
}

/**
 * A write to the log store failed. Never-throw: called from a `.catch()` on the logger's hot path,
 * so an exception here would kill the error path of every caller.
 */
export function markLogSinkWriteFailed(error: unknown): void {
  try {
    const now = new Date().toISOString();
    state.consecutiveFailures += 1;
    state.totalFailures += 1;
    state.lastFailureAt = now;
    state.firstFailureAt ??= now;

    if (!isAlertThreshold(state.consecutiveFailures)) {
      return;
    }

    const message = `[LOG_SINK_DOWN] zapis do składu logów nie powiódł się ${state.consecutiveFailures} raz(y) z rzędu — backend traci obserwowalność`;
    // Deliberately `console.error`, NOT `reportIssueBackend`: that channel just died, so reporting
    // through it would recurse into another failed write.
    console.error(message, describe(error));
    captureBackendIssue({
      mode: 'error',
      namespace: 'ALERT_LOG_SINK',
      message,
      payload: {
        consecutive_failures: state.consecutiveFailures,
        total_failures: state.totalFailures,
        first_failure_at: state.firstFailureAt,
        cause: describe(error),
      },
    });
  } catch {
    // Czujnik nigdy nie może przewrócić loggera, którego pilnuje.
  }
}

/**
 * Migawka stanu czujnika — DZIS WYLACZNIE SZEW TESTOWY.
 *
 * Komentarz obiecywal tu „health administratora", ale takiego konsumenta nie ma
 * i nigdy nie bylo (jedyne wywolania: log-sink-health.test.ts). Zostaje, bo bez
 * niego testy nie maja jak obejrzec stanu modulu — z poprawiona etykieta, zeby
 * nikt nie uznal, ze panel admina juz to pokazuje.
 *
 * Jesli kiedys naprawde trafi do health-endpointu, dolóż pole odrozniajace
 * „nigdy nie widzialem zapisu" od „zdrowy": startowe `lastSuccessAt: null`
 * i `consecutiveFailures: 0` czyta sie dzis jak zielen, a na DEVELOPMENCIE
 * zapis do skladu w ogole nie rusza (early-return w createEventLogRecord_IO).
 */
export function getLogSinkHealth(): Readonly<MutableLogSinkState> {
  return { ...state };
}
