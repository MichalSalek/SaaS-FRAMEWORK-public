import { DB_CLIENT } from '@app/db/db.client';
import {
  CLAIM_CHECKOUT_ATTEMPT_SQL,
  EXPIRE_CHECKOUT_ATTEMPT_SQL,
  PREPARE_CHECKOUT_ATTEMPT_SQL,
  READ_CHECKOUT_ATTEMPT_SQL,
  RELEASE_CHECKOUT_ATTEMPT_SQL,
  SESSION_CHECKOUT_ATTEMPT_SQL,
  START_CHECKOUT_ATTEMPT_SQL,
} from './checkout-attempt.sql';
import {
  CHECKOUT_ATTEMPT_LEASE_MS,
  CHECKOUT_ATTEMPT_SESSION_MS,
  type CheckoutAttemptRow,
  type CheckoutAttemptStore,
} from './checkout-attempt.types';

// DECISION: static shared SQL is executed verbatim by real-Postgres tests; only positional
// parameters are bound to $queryRawUnsafe. No caller input is interpolated into SQL text.
const row = async (sql: string, ...params: Array<string | number | null>) => {
  const rows = await DB_CLIENT.use.$queryRawUnsafe<CheckoutAttemptRow[]>(
    sql,
    ...params
  );
  return rows[0] ?? null;
};

export const prismaCheckoutAttemptStore: CheckoutAttemptStore = {
  read: accountId => row(READ_CHECKOUT_ATTEMPT_SQL, accountId),
  claim: (accountId, owner) =>
    row(
      CLAIM_CHECKOUT_ATTEMPT_SQL,
      accountId,
      owner,
      CHECKOUT_ATTEMPT_LEASE_MS
    ),
  start: ({ accountId, owner, attemptId, fingerprint, intentJson }) =>
    row(
      START_CHECKOUT_ATTEMPT_SQL,
      accountId,
      owner,
      attemptId,
      fingerprint,
      intentJson,
      CHECKOUT_ATTEMPT_SESSION_MS
    ),
  prepared: ({
    accountId,
    owner,
    attemptId,
    paramsJson,
    metaJson,
    customerId,
  }) =>
    row(
      PREPARE_CHECKOUT_ATTEMPT_SQL,
      accountId,
      owner,
      attemptId,
      paramsJson,
      metaJson,
      customerId
    ),
  session: ({
    accountId,
    owner,
    attemptId,
    sessionId,
    subscriptionId,
    phase,
  }) =>
    row(
      SESSION_CHECKOUT_ATTEMPT_SQL,
      accountId,
      owner,
      attemptId,
      sessionId,
      subscriptionId,
      phase
    ),
  expire: ({ accountId, owner, attemptId }) =>
    row(EXPIRE_CHECKOUT_ATTEMPT_SQL, accountId, owner, attemptId),
  release: async (accountId, owner) => {
    await row(RELEASE_CHECKOUT_ATTEMPT_SQL, accountId, owner);
  },
};
