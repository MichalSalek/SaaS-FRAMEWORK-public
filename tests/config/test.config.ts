/**
 * Test Configuration - SSOT
 * 
 * All test environment settings in one place.
 */

// Load .env.test
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

// SSOT URL/secret/admin resolution — derives from web-1/.env.development so the test
// suite never drifts from the real environment (DNS/SSL/secret). See utils/backend-env.ts.
import {
  resolveBackendUrl,
  resolveFrontendOrigin,
  fromBackendEnv,
} from '../utils/backend-env';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env.test') });

// Master-admin identity — SSOT web-1/.env.development (MASTER_ADMIN_EMAIL), with
// .env.test / shell override. Resolver reads process.env first, then the backend file.
const MASTER_ADMIN_EMAIL = fromBackendEnv('MASTER_ADMIN_EMAIL');
if (!MASTER_ADMIN_EMAIL) {
  console.error('❌ CRITICAL: MASTER_ADMIN_EMAIL not set');
  console.error('   Set it in tests/.env.test or web-1/.env.development (SSOT)');
  throw new Error(
    'MASTER_ADMIN_EMAIL required (tests/.env.test or web-1/.env.development)'
  );
}

const RESOLVED_API_URL = resolveBackendUrl(process.env.TEST_API_URL);
const RESOLVED_ORIGIN = resolveFrontendOrigin(process.env.TEST_ORIGIN);

console.log('✅ Test config loaded:');
console.log(`   API: ${RESOLVED_API_URL}`);
console.log(`   Origin: ${RESOLVED_ORIGIN}`);
console.log(`   Admin: ${MASTER_ADMIN_EMAIL}`);

// Import from shared-kernel (direct path, tests don't have @shared-kernel alias)
// NOTE: No .js extension - tsx resolves .ts files. The .js extension causes CJS/ESM
// mismatch when .shared-kernel is mounted at root (/.shared-kernel) without package.json
import { TEST_USERS_CONFIG } from '@kernel/config/test-users.config';

type TestConfig = {
  API_URL: string;
  ORIGIN: string;
  INTERNAL_SECRET?: string | undefined;
  USERS: {
    STYLIST_MAIN: string;
    CLIENT_MAIN: string;
    ADMIN_MAIN: string;
  };
  RATE_LIMIT: {
    MAX_RETRIES: number;
    RETRY_DELAY: number;
  };
};

export const TEST_CONFIG: TestConfig = {
  API_URL: RESOLVED_API_URL,
  ORIGIN: RESOLVED_ORIGIN,
  // M9 r28: dev-login wymaga nagłówka x-internal-secret gdy INTERNAL_SHARED_SECRET
  // jest skonfigurowany (defense-in-depth). SSOT = web-1/.env.development; resolver czyta
  // process.env (kontener: env_file) → plik backendu. Pusty → nagłówek nie jest wysyłany.
  INTERNAL_SECRET: fromBackendEnv('INTERNAL_SHARED_SECRET'),
  USERS: {
    STYLIST_MAIN: TEST_USERS_CONFIG.STYLIST.email,
    CLIENT_MAIN: TEST_USERS_CONFIG.CLIENT.email,
    ADMIN_MAIN: MASTER_ADMIN_EMAIL,
  },
  RATE_LIMIT: {
    MAX_RETRIES: 3,
    RETRY_DELAY: 2000,
  },
};
