/**
 * DECISION (nie usuwaj tego komentarza):
 * Publiczne aliasy health są routowane przez LOKALIZACJĘ PLIKU w `pages/`, a nie przez
 * kernelowy `ROUTES_API` (celowo: Better Stack monitoruje stabilne ścieżki spoza
 * `/api/v1`, patrz DECISION w `pages/api/health/database.ts`). Ścieżki żyją tu jako
 * SSOT, żeby limiter (`RATE_LIMIT_CONFIG.STRICT_ENDPOINTS`) i pliki tras nie rozjechały
 * się po cichu: alias poza strict-tierem oddaje nieuwierzytelnionemu skanerowi tani ping
 * ORAZ zjada wspólny, non-strict budżet całej reszty powierzchni API.
 * Zgodność każdej stałej z realnym plikiem trasy pilnuje `health-route-aliases.test.ts`.
 */
export const HEALTH_ROUTE_ALIASES = {
  /** Pasywny DB-probe (re-export health-public) — `pages/api/health/database.ts`. */
  DATABASE: '/api/health/database',
  /** Liveness probe deployu — `pages/api/health-check/index.ts`. */
  HEALTH_CHECK: '/api/health-check',
} as const;
