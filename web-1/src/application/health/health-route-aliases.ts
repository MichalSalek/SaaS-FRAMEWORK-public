/**
 * DECISION: the public health aliases are routed by FILE LOCATION in `pages/`, not through the
 * kernel `ROUTES_API` (deliberate: Better Stack monitors stable paths outside `/api/v1`, see the
 * DECISION in `pages/api/health/database.ts`). The paths live here as SSOT so the limiter
 * (`RATE_LIMIT_CONFIG.STRICT_ENDPOINTS`) and the route files cannot drift silently: an alias
 * outside the strict tier gives an unauthenticated scanner a cheap ping AND eats the shared
 * non-strict budget of the whole API surface. `health-route-aliases.test.ts` pins each constant
 * to a real route file.
 */
export const HEALTH_ROUTE_ALIASES = {
  /** Pasywny DB-probe (re-export health-public) — `pages/api/health/database.ts`. */
  DATABASE: '/api/health/database',
  /** Liveness probe deployu — `pages/api/health-check/index.ts`. */
  HEALTH_CHECK: '/api/health-check',
} as const;
