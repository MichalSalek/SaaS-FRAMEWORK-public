import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RATE_LIMIT_CONFIG } from '@app/http/rate-limit.middleware';
import { HEALTH_ROUTE_ALIASES } from './health-route-aliases';

/**
 * Health aliases are routed by the file's place under `pages/`, so the constant
 * can drift from the real route after a quiet move or rename. The limiter then
 * stops covering the alias with the strict tier and reports nothing. This test
 * turns that silent drift into a failure.
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
