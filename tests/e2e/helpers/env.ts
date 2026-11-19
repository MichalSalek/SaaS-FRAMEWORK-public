


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
