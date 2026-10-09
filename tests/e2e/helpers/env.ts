// tests/e2e/helpers/env.ts
//
// Centralised environment / endpoint configuration for the e2e suite.
//
// SSOT: pulls test user emails directly from `.shared-kernel/config/test-users.config`
// (per CLAUDE.md SSOT rule) and base URLs from the shared backend-env resolver, which
// derives from web-1/.env.development (BETTER_AUTH_URL / PUBLIC_URL) so the e2e suite
// follows DNS/SSL changes automatically instead of hardcoding localhost.

import { TEST_USERS_CONFIG } from '../../../.shared-kernel/config/test-users.config';
import {
  resolveBackendUrl,
  resolveFrontendOrigin,
} from '../../utils/backend-env';

/**
 * Resolved URLs + identities for the running e2e suite.
 *
 * `BACKEND_URL` is intentionally NOT prefixed with /api — every helper builds
 * routes with the explicit version segment (`/api/v1/...`) to mirror
 * `.shared-kernel/domain/routing/routing.config.ts`.
 */
export const E2E_ENV = {
  FRONTEND_URL: resolveFrontendOrigin(process.env['E2E_FRONTEND_URL']),
  BACKEND_URL: resolveBackendUrl(process.env['E2E_BACKEND_URL']),
  ORIGIN: resolveFrontendOrigin(process.env['E2E_FRONTEND_URL']),

  USERS: {
    STYLIST: TEST_USERS_CONFIG.STYLIST.email,
    CLIENT: TEST_USERS_CONFIG.CLIENT.email,
    ADMIN: TEST_USERS_CONFIG.ADMIN.email,
  },
} as const;
