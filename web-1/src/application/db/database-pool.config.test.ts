import { describe, expect, it } from 'vitest';
import {
  APP_LOGS_DATABASE_POOL_TUNING,
  MAIN_DATABASE_POOL_TUNING,
} from './database-pool.config';

// Ratchet pinuje KONTRAKT puli, nie przypadkowe liczby:
// (1) pula pozostaje ograniczona (`max`) i schodzi do zera (`min`),
// (2) zapytania mają twarde limity (`statement_timeout` / `query_timeout`),
// (3) budżet NAWIĄZANIA połączenia jest osobno i CELOWO hojniejszy niż limit
//     zapytania — bo czeka na wybudzenie Neona ze scale-to-zero, a nie na SQL.
// Punkt (3) to poprawka po trzech produkcyjnych `Connection terminated due to
// connection timeout` (2026-08-03 / 08-05 / 08-10) przy poprzednich 10 s.
// NIE „naprawiaj" tego z powrotem na 10 s — patrz DECISION w database-pool.config.ts.
describe('database pool tuning', () => {
  it('keeps the main pool bounded, with a cold-start-aware connect budget', () => {
    expect(MAIN_DATABASE_POOL_TUNING).toMatchObject({
      max: 5,
      min: 0,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 20_000,
      statement_timeout: 30_000,
      query_timeout: 35_000,
      keepAlive: true,
    });
  });

  it('daje nawiązaniu połączenia większy budżet niż okno recyklingu bezczynnych', () => {
    expect(MAIN_DATABASE_POOL_TUNING.connectionTimeoutMillis).toBeGreaterThan(
      MAIN_DATABASE_POOL_TUNING.idleTimeoutMillis
    );
    expect(
      APP_LOGS_DATABASE_POOL_TUNING.connectionTimeoutMillis
    ).toBeGreaterThan(APP_LOGS_DATABASE_POOL_TUNING.idleTimeoutMillis);
  });

  it('uses a smaller independent pool for app logs', () => {
    expect(APP_LOGS_DATABASE_POOL_TUNING).toMatchObject({
      max: 2,
      min: 0,
      connectionTimeoutMillis: 15_000,
      statement_timeout: 15_000,
      query_timeout: 20_000,
      keepAlive: true,
    });
  });
});
