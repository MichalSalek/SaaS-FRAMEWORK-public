import { beforeEach, describe, expect, it, vi } from 'vitest';

// RED-first guard dla cichej utraty logów. Regresja z produkcji: wyjątek
// z 2026-08-10 istnieje w PostHogu, ale NIE ma go w AppLogRecord — flush poległ,
// a stara implementacja robiła `buffer.splice(0)` i gubiła całą partię bez śladu.
// Traciliśmy więc logi dokładnie wtedy, gdy baza pada, czyli gdy są najcenniejsze.

const holder = vi.hoisted(() => ({
  createMany: vi.fn(async (_args: { data: unknown[] }) => undefined),
}));

vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    use: new Proxy({}, { get: () => async () => undefined }),
    useAppLogs: {
      appLogRecord: {
        createMany: (args: { data: unknown[] }) => holder.createMany(args),
      },
    },
  },
}));

vi.mock('@app/environment/environment.config', () => ({
  ENV_VARS: { ENABLE_APP_LOGS_DB: true },
}));

vi.mock('@app/environment/environment.utils.api', () => ({
  IS_DEVELOPMENT_ENV: () => false,
  getEnvironmentMode: () => 'PRODUCTION',
}));

const sink = vi.hoisted(() => ({ failed: vi.fn(), succeeded: vi.fn() }));
vi.mock('./log-sink-health', () => ({
  markLogSinkWriteFailed: (e: unknown) => sink.failed(e),
  markLogSinkWriteSucceeded: () => sink.succeeded(),
}));

const { createEventLogRecord_IO, flushLogBuffer, __resetLogBufferForTests } =
  await import('./error-handler-io');

const entry = (message: string) => ({
  environment: 'PRODUCTION',
  type: 'error' as const,
  namespace: 'TEST',
  message,
  payload: '{}',
  user_metadata: '{}',
  client_url: 'GET /test',
  application: 'backend' as const,
  event_log_chain_id: '0',
  user_id: null,
});

describe('log buffer — partia nie znika przy awarii zapisu', () => {
  beforeEach(() => {
    __resetLogBufferForTests();
    holder.createMany.mockReset();
    holder.createMany.mockImplementation(async () => undefined);
  });

  it('zapisuje wpis, gdy baza odpowiada', async () => {
    await createEventLogRecord_IO(entry('ok'));
    await flushLogBuffer();

    expect(holder.createMany).toHaveBeenCalledTimes(1);
    const batch = holder.createMany.mock.calls[0]?.[0]?.data as Array<{
      message: string;
    }>;
    expect(batch.map(item => item.message)).toEqual(['ok']);
  });

  it('po nieudanym flushu wpis NIE ginie — wraca do bufora i dojeżdża później', async () => {
    holder.createMany.mockRejectedValueOnce(new Error('db down'));

    await createEventLogRecord_IO(entry('incydent'));
    await flushLogBuffer(); // pada

    expect(holder.createMany).toHaveBeenCalledTimes(1);

    await flushLogBuffer(); // baza wróciła

    expect(holder.createMany).toHaveBeenCalledTimes(2);
    const retried = holder.createMany.mock.calls[1]?.[0]?.data as Array<{
      message: string;
    }>;
    expect(retried.map(item => item.message)).toEqual(['incydent']);
  });

  it('kolejność wpisów przeżywa ponowienie', async () => {
    holder.createMany.mockRejectedValueOnce(new Error('db down'));

    await createEventLogRecord_IO(entry('pierwszy'));
    await flushLogBuffer();
    await createEventLogRecord_IO(entry('drugi'));
    await flushLogBuffer();

    const retried = holder.createMany.mock.calls[1]?.[0]?.data as Array<{
      message: string;
    }>;
    expect(retried.map(item => item.message)).toEqual(['pierwszy', 'drugi']);
  });

  it('współbieżne flushe dzielą jedno wykonanie (bez podwójnego zapisu)', async () => {
    await createEventLogRecord_IO(entry('a'));

    await Promise.all([flushLogBuffer(), flushLogBuffer(), flushLogBuffer()]);

    expect(holder.createMany).toHaveBeenCalledTimes(1);
  });

  it('utrata wpisów po przepełnieniu bufora jest RAPORTOWANA, nie cicha', async () => {
    holder.createMany.mockRejectedValue(new Error('db down'));

    // 600 wpisów > RETRY_BUFFER_LIMIT (500) → 100 najstarszych musi odpaść.
    for (let index = 0; index < 600; index++) {
      await createEventLogRecord_IO(entry(`wpis-${index}`));
      await flushLogBuffer();
    }

    holder.createMany.mockImplementation(async () => undefined);
    await flushLogBuffer(); // baza wróciła — partia przechodzi
    await flushLogBuffer(); // syntetyczny rekord o utracie

    const lastBatch = holder.createMany.mock.calls.at(-1)?.[0]?.data as Array<{
      namespace: string;
      message: string;
    }>;
    expect(
      lastBatch.some(item => item.namespace === 'LOG_BUFFER_OVERFLOW')
    ).toBe(true);
  });
});

describe('log buffer — twardy sufit pamięci na ścieżce zapisu', () => {
  beforeEach(() => {
    __resetLogBufferForTests();
    holder.createMany.mockReset();
    holder.createMany.mockImplementation(async () => undefined);
  });

  it('nie rośnie bez granic, gdy baza leży i cooldown blokuje flushe', async () => {
    holder.createMany.mockRejectedValue(new Error('db down'));

    // Realny scenariusz: burza błędów przy leżącej bazie. Pierwszy flush pada
    // i uzbraja cooldown, więc kolejne 1500 wpisów NIC nie opróżnia — sufit
    // musi trzymać sama ścieżka zapisu.
    for (let index = 0; index < 1_500; index++) {
      await createEventLogRecord_IO(entry(`wpis-${index}`));
    }

    holder.createMany.mockReset();
    holder.createMany.mockImplementation(async () => undefined);
    await flushLogBuffer();

    const batch = holder.createMany.mock.calls[0]?.[0]?.data as unknown[];
    expect(batch).toBeDefined();
    expect(batch.length).toBeLessThanOrEqual(500);
  });
});

/**
 * WPIĘCIE czujnika żywotności, nie sam czujnik (ten ma własną suitę).
 *
 * KLASA BŁĘDU, którą ta suita pinuje (znaleziona w przeglądzie S113): pierwsza wersja
 * czujnika wisiała na `createEventLogRecord_IO(...).then(...)`. Ta funkcja tylko dokłada
 * wpis do bufora i wraca — NIE ma ścieżki odrzucenia — więc alarm nie mógł się odpalić
 * nigdy, a sygnał sukcesu strzelał przy każdej linii logu. Czujnik był martwy i wyglądał
 * na żywy: moduł miał własne, przechodzące testy, bo testowały go w izolacji.
 * Dlatego ta suita mierzy WYŁĄCZNIE to, czy sygnał wychodzi z REALNEGO zapisu do bazy.
 */
describe('czujnik żywotności składu logów — wpięty w realny zapis, nie w bufor', () => {
  beforeEach(() => {
    __resetLogBufferForTests();
    holder.createMany.mockReset();
    holder.createMany.mockImplementation(async () => undefined);
    sink.failed.mockReset();
    sink.succeeded.mockReset();
  });

  it('samo zbuforowanie NIE melduje sukcesu (to jeszcze nie jest zapis)', async () => {
    await createEventLogRecord_IO(entry('buffered only'));
    expect(sink.succeeded).not.toHaveBeenCalled();
    expect(sink.failed).not.toHaveBeenCalled();
  });

  it('nieudany flush melduje PORAŻKĘ i przekazuje przyczynę', async () => {
    const boom = new Error('log DB unreachable');
    holder.createMany.mockRejectedValueOnce(boom);

    await createEventLogRecord_IO(entry('will fail'));
    await flushLogBuffer();

    expect(sink.failed).toHaveBeenCalledTimes(1);
    expect(sink.failed).toHaveBeenCalledWith(boom);
    expect(sink.succeeded).not.toHaveBeenCalled();
  });

  it('udany flush melduje sukces RAZ NA PARTIĘ, nie raz na wpis', async () => {
    await createEventLogRecord_IO(entry('a'));
    await createEventLogRecord_IO(entry('b'));
    await createEventLogRecord_IO(entry('c'));
    await flushLogBuffer();

    expect(sink.succeeded).toHaveBeenCalledTimes(1);
    expect(sink.failed).not.toHaveBeenCalled();
  });
});
