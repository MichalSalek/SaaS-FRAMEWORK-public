import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RATE_LIMIT_CONFIG } from '@app/http/rate-limit.middleware';
import { HEALTH_ROUTE_ALIASES } from './health-route-aliases';

/**
 * Aliasy health są routowane przez lokalizację pliku w `pages/`, więc stała może się
 * rozjechać z realną trasą po cichym przeniesieniu/zmianie nazwy pliku — a wtedy limiter
 * przestaje objąć alias strict-tierem, nie zgłaszając żadnego błędu. Ten test zamienia
 * ten cichy dryf w czerwony test.
 */
const PAGES_DIR = fileURLToPath(new URL('../../pages', import.meta.url));

const routeFileExists = (routePath: string): boolean =>
  existsSync(`${PAGES_DIR}${routePath}.ts`) ||
  existsSync(`${PAGES_DIR}${routePath}/index.ts`);

describe('health route aliases', () => {
  const aliases = Object.entries(HEALTH_ROUTE_ALIASES);

  it.each(aliases)('%s wskazuje na istniejący plik trasy', (_name, path) => {
    expect(routeFileExists(path)).toBe(true);
  });

  it.each(aliases)('%s należy do strict-tieru rate-limitu', (_name, path) => {
    expect(RATE_LIMIT_CONFIG.STRICT_ENDPOINTS).toContain(path);
  });
});
