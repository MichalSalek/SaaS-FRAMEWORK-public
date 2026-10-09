import type { PoolConfig } from 'pg';

// DECISION (nie usuwaj tego komentarza):
// `connectionTimeoutMillis` jest USTAWIONE POD NEON SCALE-TO-ZERO, nie pod czas
// sieci. Gdy compute jest uśpiony, pierwsze połączenie musi poczekać na wybudzenie
// instancji — przy 10 s (poprzednia wartość) produkcja zwracała `Connection
// terminated due to connection timeout` na zimny start: 2026-08-03, 08-05 i 08-10
// (publiczny `track-crawler` sypał 500 zamiast poczekać na obudzoną bazę).
// Podwojenie budżetu mieści wybudzenie z zapasem, a NIE wydłuża zapytań —
// `statement_timeout` / `query_timeout` pilnują ich niezależnie i zostają bez zmian.
//
// `keepAlive` trzyma TCP przy życiu, żeby pośrednicy (Render → Neon proxy) nie
// zrywali bezczynnych połączeń z puli; zerwane gniazdo objawiało się jako
// `Connection terminated unexpectedly` — drugi komunikat z tej samej serii.
const NEON_COLD_START_CONNECT_BUDGET_MS = 20_000;
const APP_LOGS_COLD_START_CONNECT_BUDGET_MS = 15_000;

const KEEP_ALIVE = Object.freeze({
  keepAlive: true,
  keepAliveInitialDelayMillis: 5_000,
});

export const MAIN_DATABASE_POOL_TUNING = Object.freeze({
  max: 5,
  min: 0,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: NEON_COLD_START_CONNECT_BUDGET_MS,
  statement_timeout: 30_000,
  query_timeout: 35_000,
  idle_in_transaction_session_timeout: 30_000,
  application_name: 'nailfolio-api',
  ...KEEP_ALIVE,
} satisfies Omit<PoolConfig, 'connectionString'>);

export const APP_LOGS_DATABASE_POOL_TUNING = Object.freeze({
  max: 2,
  min: 0,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: APP_LOGS_COLD_START_CONNECT_BUDGET_MS,
  statement_timeout: 15_000,
  query_timeout: 20_000,
  idle_in_transaction_session_timeout: 15_000,
  application_name: 'nailfolio-app-logs',
  ...KEEP_ALIVE,
} satisfies Omit<PoolConfig, 'connectionString'>);
