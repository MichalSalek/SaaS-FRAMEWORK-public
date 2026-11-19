// tests/utils/seeded-session.ts
//
// Session minting for runs against a PRODUCTION-mode backend (TEST_AUTH_MODE=seeded-session).
//
// dev-login exists only when NODE_ENV_MANUAL=DEVELOPMENT, and the CI backend runs a
// `next build --webpack` + `next start` artifact in PREVIEW mode, where dev-login answers 404.
// So the harness writes the session row into the DISPOSABLE database instead of opening a test
// door in production code: Better Auth's bearer() plugin resolves `Authorization: Bearer <token>`
// through "Session".session_token, the row createManualSessionForUser_IO writes for dev-login.
//
// User creation mirrors web-1/src/pages/api/auth/dev-login/index.ts: a fresh e-mail becomes a
// STYLIST with an ACTIVE FREE StylistAccount; MASTER_ADMIN_EMAIL becomes role_master_admin; an
// existing user only gets a new session. Guard: refuses unless TEST_DATABASE_URL points at a
// local/CI host, so a misconfigured shell cannot write sessions into a shared database.

import { randomBytes } from 'crypto';
import { dbQuery, dbQueryOne, resolveDatabaseUrl } from './db-client';

const DISPOSABLE_HOSTS = new Set(['127.0.0.1', 'localhost', 'postgres']);
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export const isSeededSessionMode = (): boolean =>
  process.env.TEST_AUTH_MODE === 'seeded-session';

const assertDisposableDatabase = (): void => {
  const explicit = process.env.TEST_DATABASE_URL;
  if (!explicit) {
    throw new Error(
      'seeded-session: TEST_DATABASE_URL must be set explicitly (source tests/ci/ci-env.sh)'
    );
  }
  const host = new URL(resolveDatabaseUrl()).hostname;
  if (!DISPOSABLE_HOSTS.has(host)) {
    throw new Error(
      `seeded-session: refusing non-disposable database host "${host}"`
    );
  }
};

const newId = (prefix: string): string =>
  `${prefix}_${randomBytes(12).toString('hex')}`;

const ensureUser = async (email: string): Promise<string> => {
  const existing = await dbQueryOne<{ id: string }>(
    'SELECT id FROM "users" WHERE email = $1',
    [email]
  );
  if (existing) {
    return existing.id;
  }
  const adminEmail = (process.env.MASTER_ADMIN_EMAIL ?? '')
    .trim()
    .toLowerCase();
  const isAdmin = adminEmail !== '' && email === adminEmail;
  const userId = newId('seeded_u');
  await dbQuery(
    `INSERT INTO "users" (id, email, email_verified, role_id, account_type, is_active, updated_at)
     VALUES ($1, $2, true, $3, 'STYLIST', true, now())`,
    [userId, email, isAdmin ? 'role_master_admin' : 'role_stylist']
  );
  await dbQuery(
    `INSERT INTO "StylistAccount"
       (account_id, created_by_user_id, display_name, address_city, pricing_plan, payment_status, account_status)
     VALUES ($1, $2, $3, 'Test City', 'FREE', 'PAID', 'ACTIVE')`,
    [newId('seeded_sa'), userId, email.split('@')[0] ?? email]
  );
  return userId;
};

/** Write a live session row for `email` (creating the user like dev-login would) and return its bearer token. */
export const mintSeededSessionToken = async (
  rawEmail: string
): Promise<string> => {
  assertDisposableDatabase();
  const email = rawEmail.trim().toLowerCase();
  const userId = await ensureUser(email);
  const token = randomBytes(32).toString('hex');
  await dbQuery(
    `INSERT INTO "Session" (id, session_token, user_id, expires, user_agent, updated_at)
     VALUES ($1, $2, $3, $4, 'nf-test-harness', now())`,
    [newId('seeded_s'), token, userId, new Date(Date.now() + SESSION_TTL_MS)]
  );
  return token;
};
