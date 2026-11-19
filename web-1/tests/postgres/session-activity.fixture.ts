import type { CurrentUser } from '@kernel/models/user/user.types';
import { Pool } from 'pg';
import { createAuthDb, type AuthDb } from './auth-db.fixture';

/** A unique schema in a dedicated loopback-only test DB; never connect to an app database. */
export async function createSessionActivityDb(url: string): Promise<AuthDb> {
  const parsed = new URL(url);
  if (
    !['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname) ||
    !/^\/nf_session_activity_[a-z0-9_]+$/.test(parsed.pathname)
  ) {
    throw new Error(
      'Session activity tests require a dedicated loopback nf_session_activity_* database'
    );
  }
  const admin = new Pool({ connectionString: url, max: 1 });
  const client = await admin.connect();
  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtext('nf-session-activity-extension'))"
    );
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    } finally {
      await client.query(
        "SELECT pg_advisory_unlock(hashtext('nf-session-activity-extension'))"
      );
    }
  } finally {
    client.release();
    await admin.end();
  }
  return createAuthDb(url);
}

let sequence = 0;
export async function sessionActivityFixture(db: AuthDb) {
  const key = `activity_${++sequence}`;
  const clientKey = `${key}_client`;
  const stylistKey = `${key}_stylist`;
  await db.seedUser(clientKey, 'CLIENT');
  await db.seedUser(stylistKey, 'STYLIST', 'STUDIO');
  const clientUserId = db.idOf(clientKey);
  const stylistUserId = db.idOf(stylistKey);
  const stylistAccountId = `sa_${stylistKey}`;
  const clientAccount = await db.seeder.clientAccount.findUniqueOrThrow({
    where: { created_by_user_id: clientUserId },
  });
  const pair = await db.seeder.clientStylistPair.create({
    data: {
      client_user_id: clientUserId,
      stylist_account_id: stylistAccountId,
      status: 'ACTIVE',
    },
  });
  const session = await db.seeder.sessionContainer.create({
    data: {
      client_account_id: clientAccount.client_account_id,
      stylist_account_id: stylistAccountId,
      lifecycle_state: 'SHARED',
      shared_at: new Date(),
      expires_at: new Date(Date.now() + 86_400_000),
    },
  });
  const client = {
    id: clientUserId,
    is_active: true,
    client_account: { client_account_id: clientAccount.client_account_id },
    stylist_account: null,
  } as unknown as CurrentUser;
  const stylist = {
    id: stylistUserId,
    is_active: true,
    client_account: null,
    stylist_account: { account_id: stylistAccountId },
  } as unknown as CurrentUser;
  return {
    sessionId: session.id,
    pairId: pair.id,
    clientUserId,
    stylistUserId,
    stylistAccountId,
    clientAccountId: clientAccount.client_account_id,
    client,
    stylist,
  };
}
export type SessionActivityFixture = Awaited<
  ReturnType<typeof sessionActivityFixture>
>;
