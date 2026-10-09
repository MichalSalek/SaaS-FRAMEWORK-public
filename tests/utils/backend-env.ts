// tests/utils/backend-env.ts
//
// SSOT resolver for test base URLs / secrets / identities.
//
// WHY THIS EXISTS: the backend dev env (`web-1/.env.development`) is the single
// source of truth for environment URLs (BETTER_AUTH_URL, PUBLIC_URL), the internal
// dev-login secret (INTERNAL_SHARED_SECRET) and the master-admin email. Test configs
// used to DUPLICATE those values (`tests/.env.test` had `http://localhost:3001`),
// so when the environment changed (DNS + SSL: https://api.dev.example.com)
// the test suite silently drifted out of sync and every request died with an empty
// reply (HTTP client hitting an HTTPS port). Fix: DERIVE from the backend env here
// instead of hardcoding, so each session picks up the REAL current values.
//
// Resolution order per key:
//   1. explicit override (shell / .env.test / CI / E2E_* var) — caller passes it
//   2. backend dev env, `process.env` first (in-container: backend env_file), then
//      `web-1/.env.development` parsed from disk (host runs)
//   3. legacy localhost fallback (clean local dev without DNS/SSL)

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse the backend dev env from disk (host runs). In a container `web-1/.env.development`
// is NOT mounted under tests/, so this throws — that's fine: the same values are already
// present in process.env via the backend's env_file. Never let a missing file crash config.
let backendEnv: Record<string, string> = {};
try {
  backendEnv = dotenv.parse(
    fs.readFileSync(path.resolve(__dirname, '../../web-1/.env.development'))
  );
} catch {
  /* in-container or env file absent — rely on process.env below */
}

const firstCsv = (value?: string): string | undefined =>
  value?.split(',')[0]?.trim() || undefined;

/** Resolve a backend env value: explicit process.env wins, then the parsed dev file. */
export const fromBackendEnv = (key: string): string | undefined =>
  process.env[key] || backendEnv[key] || undefined;

/**
 * Backend base URL (no trailing /api). SSOT: `BETTER_AUTH_URL` in web-1/.env.development.
 * @param override caller-specific explicit value (TEST_API_URL for smoke, E2E_BACKEND_URL for e2e)
 */
export const resolveBackendUrl = (override?: string): string =>
  override || fromBackendEnv('BETTER_AUTH_URL') || 'http://localhost:3001';

/**
 * Frontend origin used for the CORS/Origin header. SSOT: `PUBLIC_URL` (first CSV entry).
 * @param override caller-specific explicit value (TEST_ORIGIN for smoke, E2E_FRONTEND_URL for e2e)
 */
export const resolveFrontendOrigin = (override?: string): string =>
  override || firstCsv(fromBackendEnv('PUBLIC_URL')) || 'http://localhost:3000';
