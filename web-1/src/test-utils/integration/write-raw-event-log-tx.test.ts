/**
 * BUG-A characterization — writeRawEventLog_IO swallow-on-error (BDX W0.3 B / W3.0).
 *
 * `writeRawEventLog_IO` (application/event-log/event-log.client.ts, ~l.64-89) picks its
 * Prisma client as `const db = tx ?? DB_CLIENT.use` and wraps the `db.eventLog.create`
 * call in a try/catch that, on ANY error, reports it and `return undefined`.
 *
 * That swallow is CORRECT for the non-transactional fire-and-forget path: an audit-log
 * write failing must never break the request it is auditing.
 *
 * BUG-A: the SAME swallow also fires when a caller passed a `tx`. A tx-aware write is
 * part of an OUTER transaction — if its insert throws and we swallow it, the caller's
 * transaction is NOT signalled to roll back (the error never propagates), so the audit
 * row is silently missing while the rest of the tx commits. The tx-aware path SHOULD
 * rethrow so the surrounding transaction aborts.
 *
 * W3.0 fixed BUG-A: the non-tx path still swallows (fire-and-forget), the tx-aware path
 * now rethrows so the surrounding transaction rolls back. Both behaviors are pinned here.
 *
 * We call the IO function DIRECTLY (not via mockApiHandler) — it is application logic,
 * not a route. The non-tx path resolves `DB_CLIENT.use` (mocked in setup.ts; here we
 * make eventLog.create throw via mockDb). The tx path uses a locally-built mock-tx whose
 * eventLog.create throws.
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
