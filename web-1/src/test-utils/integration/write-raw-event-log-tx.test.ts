/**
 * Characterization of writeRawEventLog_IO swallow-on-error.
 * `writeRawEventLog_IO` (application/event-log/event-log.client.ts) picks its Prisma client as
 * `const db = tx ?? DB_CLIENT.use` and wraps `db.eventLog.create` in a try/catch that, on any
 * error, reports it and returns undefined.
 * The swallow is right for the non-transactional fire-and-forget path: a failing audit-log
 * write must never break the request it audits. With a caller-passed `tx` the write belongs to
 * an outer transaction; swallowing there would let the transaction commit with the audit row
 * silently missing. So the non-tx path swallows and the tx-aware path rethrows, which aborts
 * the surrounding transaction. Both behaviors are pinned here.
 * The IO function is called directly (application logic, not a route). The non-tx path
 * resolves `DB_CLIENT.use` (mocked in setup.ts; eventLog.create throws via mockDb). The tx
 * path uses a locally built mock-tx whose eventLog.create throws.
 */

import { describe, it, expect } from 'vitest';
import { mockDb } from '../mockApiHandler';
import { writeRawEventLog_IO } from '@app/event-log/event-log.client';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import type { Prisma } from '../../prisma/js-client';

// Minimal, type-valid props that pass the early guards (eventLogType present,
// created_by_user_id is a real id — not undefined/null/'0'/'').
const BASE_PROPS = {
  eventName: APP_EVENTS.INFO.ACCOUNT.PUBLIC_PROFILE_FETCHED,
  eventLogType: EventLogTypeValue.ACCOUNT,
  meta: { created_by_user_id: 'usr_test_0000000000000001' },
} as const;

const BOOM = new Error('eventLog.create exploded');

/**
 * Build a mock Prisma TransactionClient whose `eventLog.create` throws. Only the one
 * method the function under test touches is implemented; cast through `unknown` keeps
 * us off `any`/`!` while satisfying the broad TransactionClient surface.
 */
const makeThrowingTx = (): Prisma.TransactionClient => {
  const tx = {
    eventLog: {
      create: async (): Promise<never> => {
        throw BOOM;
      },
    },
  };
  return tx as unknown as Prisma.TransactionClient;
};

describe('writeRawEventLog_IO — BUG-A swallow characterization', () => {
  it('non-tx: swallows a create error and returns undefined (correct for fire-and-forget)', async () => {
    mockDb({
      eventLog: {
        create: async () => {
          throw BOOM;
        },
      },
    });

    const result = await writeRawEventLog_IO(BASE_PROPS);

    // Non-transactional audit write must never throw at the caller — swallow is by design.
    expect(result).toBeUndefined();
  });

  it('tx-aware: rethrows a create error so the outer transaction rolls back (W3.0 fix)', async () => {
    // BUG-A FIXED (W3.0): when a `tx` is passed, a failed audit insert MUST propagate so
    // the surrounding `$transaction` aborts — otherwise the account mutation commits
    // without its financial audit row and `processed=true` blocks any retry.
    const tx = makeThrowingTx();

    await expect(writeRawEventLog_IO({ ...BASE_PROPS, tx })).rejects.toThrow(
      BOOM
    );
  });
});
