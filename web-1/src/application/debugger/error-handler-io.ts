import type { EventLogRecord } from '@kernel/models/db_models.manual.dto';
import { DB_CLIENT } from '@app/db/db.client';
import {
  markLogSinkWriteFailed,
  markLogSinkWriteSucceeded,
} from './log-sink-health';
import { ENV_VARS } from '@app/environment/environment.config';
import {
  getEnvironmentMode,
  IS_DEVELOPMENT_ENV,
} from '@app/environment/environment.utils.api';

// ---------------------------------------------------------------------------
// Log buffer — batches individual log entries into createMany calls.
// Intentionally in-memory: log loss on a hard crash is an accepted trade-off.
// ---------------------------------------------------------------------------

type LogEntry = Omit<EventLogRecord, 'id' | 'created_at'>;

const FLUSH_INTERVAL_MS = 200;
const MAX_BUFFER_SIZE = 50;

// DECISION (nie usuwaj tego komentarza):
// Nieudany zapis WRACA do bufora zamiast znikać. Stara wersja robiła
// `buffer.splice(0)` i przy błędzie gubiła całą partię — czyli traciliśmy logi
// dokładnie wtedy, gdy są najcenniejsze (baza pada). Zweryfikowane na produkcji:
// wyjątek z 2026-08-10 jest w PostHogu, ale w AppLogRecord go nie ma, bo flush
// poległ i partia przepadła bez śladu.
//
// Retencja jest OGRANICZONA (RETRY_BUFFER_LIMIT): przy długiej awarii bazy pamięć
// procesu nie może rosnąć bez końca, więc najstarsze wpisy są odrzucane, a ich
// liczba jest RAPORTOWANA syntetycznym rekordem po powrocie bazy — cicha utrata
// logów była pierwotnym problemem, więc nie zastępujemy jej inną cichą utratą.
const RETRY_BUFFER_LIMIT = 500;

// Po nieudanym flushu nie ponawiamy natychmiast — inaczej każdy kolejny log
// (bufor stale powyżej progu) dobijałby się do leżącej bazy w pętli.
const FLUSH_COOLDOWN_AFTER_FAILURE_MS = 5_000;

const buffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushInFlight: Promise<void> | null = null;
let nextAttemptAllowedAtMs = 0;
let droppedEntryCount = 0;

const buildDropNoticeEntry = (dropped: number): LogEntry => ({
  environment: getEnvironmentMode(),
  type: 'warn',
  namespace: 'LOG_BUFFER_OVERFLOW',
  message: `Odrzucono ${dropped} wpisów logu podczas niedostępności bazy logów (limit bufora ${RETRY_BUFFER_LIMIT}).`,
  payload: JSON.stringify({ dropped, limit: RETRY_BUFFER_LIMIT }),
  user_metadata: JSON.stringify({ callstack: [] }),
  client_url: 'system',
  application: 'backend',
  event_log_chain_id: '0',
  user_id: null,
});

/**
 * Przycina bufor do limitu, licząc odrzucone wpisy. Odpada NAJSTARSZE — przy
 * dłuższej awarii świeższe wpisy niosą aktualny stan incydentu.
 */
const trimToLimit = (): void => {
  if (buffer.length <= RETRY_BUFFER_LIMIT) {
    return;
  }
  const overflow = buffer.length - RETRY_BUFFER_LIMIT;
  buffer.splice(0, overflow);
  droppedEntryCount += overflow;
};

/** Zwraca partię z powrotem na początek bufora, przycinając do limitu. */
const requeue = (batch: LogEntry[]): void => {
  buffer.unshift(...batch);
  trimToLimit();
};

const runFlush = async (): Promise<void> => {
  if (buffer.length === 0) {
    return;
  }

  const batch = buffer.splice(0);

  // DECISION (nie usuwaj tego komentarza) — ZAKRES `try` KONCZY SIE NA ZAPISIE:
  // ksiegowanie po udanym `createMany` (czujnik zywotnosci, notka o porzuconych
  // wpisach) stalo WEWNATRZ tego bloku, wiec dowolny wyjatek PO utrwaleniu partii
  // wpadal do `catch` i robil dwie szkody naraz: wracal do bufora partie, ktora
  // JEST juz w bazie (duplikaty wierszy), i melodowal `[LOG_SINK_DOWN]` o skladzie,
  // ktory wlasnie odpowiedzial poprawnie. Falszywa czerwien jest tu rownie kosztowna
  // co falszywa zielen — czujnik musi odrozniac „nie umiem zmierzyc" od „nie dziala".
  let persisted = false;
  try {
    await DB_CLIENT.useAppLogs.appLogRecord.createMany({ data: batch });
    persisted = true;
  } catch (error) {
    // Zapis logu nigdy nie może wywrócić aplikacji — partia wraca do bufora
    // i poczeka na kolejny tik timera.
    nextAttemptAllowedAtMs = Date.now() + FLUSH_COOLDOWN_AFTER_FAILURE_MS;
    requeue(batch);
    console.error(
      `[log-buffer] flush failed, ${buffer.length} entries retained (dropped so far: ${droppedEntryCount}):`,
      error
    );
    // TO jest miejsce, w którym awaria składu logów jest w ogóle widoczna.
    markLogSinkWriteFailed(error);
  }

  if (!persisted) {
    return;
  }

  nextAttemptAllowedAtMs = 0;
  // Czujnik żywotności składu logów pinuje się TUTAJ, bo tu jest jedyny realny
  // zapis do bazy. Patrz DECISION w `log-sink-health.ts`.
  markLogSinkWriteSucceeded();

  if (droppedEntryCount > 0) {
    const notice = buildDropNoticeEntry(droppedEntryCount);
    droppedEntryCount = 0;
    buffer.push(notice);
  }
};

/**
 * Opróżnia bufor logów. Współbieżne wywołania (timer + próg rozmiaru + shutdown)
 * dzielą JEDNO wykonanie — bez tego dwa flushe mogłyby wysłać rozjechane partie
 * i podwoić ruch do bazy w trakcie awarii.
 */
export async function flushLogBuffer(): Promise<void> {
  if (flushInFlight) {
    return flushInFlight;
  }
  flushInFlight = runFlush().finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

const flushIfAllowed = (): void => {
  if (Date.now() < nextAttemptAllowedAtMs) {
    return;
  }
  void flushLogBuffer();
};

function ensureFlushTimer(): void {
  if (flushTimer !== null) {
    return;
  }

  flushTimer = setInterval(flushIfAllowed, FLUSH_INTERVAL_MS);

  // Allow the process to exit even if the timer is still running.
  if (typeof flushTimer === 'object' && 'unref' in flushTimer) {
    flushTimer.unref();
  }
}

// Best-effort flush on shutdown.
process.on('beforeExit', () => {
  void flushLogBuffer();
});

// ---------------------------------------------------------------------------
// Public API — unchanged signature
// ---------------------------------------------------------------------------

export const createEventLogRecord_IO = async (
  data: LogEntry
): Promise<void> => {
  if (IS_DEVELOPMENT_ENV() && !ENV_VARS.ENABLE_APP_LOGS_DB) {
    return;
  }

  buffer.push(data);
  // Twardy sufit także na ścieżce zapisu: w cooldownie po nieudanym flushu nic
  // nie opróżnia bufora, więc burza błędów przy leżącej bazie rosłaby bez granic.
  trimToLimit();
  ensureFlushTimer();

  if (buffer.length >= MAX_BUFFER_SIZE) {
    flushIfAllowed();
  }
};

/** Tylko dla testów — czyści bufor i stan ponowień między przypadkami. */
export const __resetLogBufferForTests = (): void => {
  buffer.length = 0;
  droppedEntryCount = 0;
  nextAttemptAllowedAtMs = 0;
  flushInFlight = null;
  if (flushTimer !== null) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
};
