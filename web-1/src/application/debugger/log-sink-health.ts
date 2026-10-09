import { captureBackendIssue } from './posthog-server';

/**
 * Czujnik żywotności SKŁADU LOGÓW (tabela EventLog w bazie logów).
 *
 * DECISION (nie usuwaj tego komentarza) — S113, 2026-09-10:
 * `reportIssueBackend` kończył się linią `createEventLogRecord_IO(input).catch(() => {})`.
 *
 * SPROSTOWANIE (przegląd S113): ten `.catch` nie łapał niczego istotnego, bo
 * `createEventLogRecord_IO` tylko buforuje i nie ma ścieżki odrzucenia. Pierwsza wersja
 * tego czujnika wisiała na tamtym wywołaniu i przez to była MARTWA. Prawdziwy zapis do
 * bazy robi `runFlush` w `error-handler-io.ts` i tam czujnik jest dziś wpięty — jeden
 * sygnał na PARTIĘ, nie na linię logu. Kto go przenosi, musi trafić w to samo miejsce.
 *
 * Sedno problemu jest niezmienne: gdy zapis do składu logów zaczyna padać
 * (baza logów niedostępna, wyczerpana quota compute Neona, zmiana schematu), aplikacja
 * traci obserwowalność CAŁKOWICIE I W CISZY: nie ma błędu, nie ma metryki, nie ma wpisu —
 * bo jedynym miejscem, gdzie taki wpis mógłby powstać, jest kanał, który właśnie umarł.
 * Awaria loggera jest z definicji niewidoczna dla samego loggera, więc alarm MUSI wyjść
 * kanałem, który nie zależy od bazy.
 *
 * Kanały alarmu (oba bez bazy):
 *   1. `console.error` z markerem `[LOG_SINK_DOWN]` — trafia na stdout procesu, czyli
 *      do logów PM2/Render, po których można postawić alert tekstowy.
 *   2. PostHog Error Tracking (`captureBackendIssue`) — osobny dostawca, ma już alert
 *      dzienny. To jest właściwy dead-man's switch: żyje, gdy nasza baza nie żyje.
 *
 * Dławienie: przy trwałej awarii KAŻDY log w aplikacji generowałby alarm, czyli awaria
 * składu logów zamieniłaby się w zalanie stdoutu i wyczerpanie quoty PostHoga. Alarmujemy
 * więc na progach będących potęgami dziesiątki (1, 10, 100, 1000, …) liczonych po serii
 * NIEPRZERWANYCH porażek — pierwsza porażka jest głośna natychmiast, a trwała awaria
 * kosztuje logarytmicznie. Po powrocie zapisów wysyłamy JEDEN wpis o odzyskaniu z długością
 * serii; bez niego widać początek awarii, ale nigdy jej koniec.
 *
 * Stan MUSI żyć na `globalThis`, nie w zmiennych module-level: Next bundluje ten moduł
 * osobno dla `instrumentation.ts` i dla `pages/api` (ten sam mechanizm, który opisuje
 * DECISION w `db-availability.state.ts`). Dwie kopie licznika oznaczałyby dwie niezależne
 * drabinki progów — alarm nadal by wyszedł, ale statystyka serii kłamałaby.
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
 * Alarmujemy, gdy długość serii jest potęgą dziesiątki. Sprawdzamy to bez logarytmu
 * (`Math.log10` na liczbach takich jak 1000 potrafi dać 2.9999999999999996), dzieląc
 * przez dziesięć dopóki się dzieli.
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

/** Zapis do składu logów się powiódł. Zamyka serię i raportuje odzyskanie. */
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
 * Zapis do składu logów padł. Never-throw — wołane z `.catch()` w gorącej ścieżce
 * loggera, więc wyjątek stąd zabiłby ścieżkę błędu każdego callera.
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
    // Świadomie `console.error`, a NIE `reportIssueBackend`: ten kanał właśnie padł,
    // więc zgłoszenie przez niego byłoby rekurencją zakończoną kolejną porażką zapisu.
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
