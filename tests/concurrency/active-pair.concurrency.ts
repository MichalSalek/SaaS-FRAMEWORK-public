// tests/concurrency/active-pair.concurrency.ts
// FAMILY 1: active-pair race (SessionContainer partial-unique index 'session_container_active_pair_uq').
//
// INVARIANT: at most ONE non-terminal SessionContainer per (client_account_id, stylist_account_id);
// the index applies WHERE lifecycle_state NOT IN ('CLOSED','EXPIRED') AND stylist_account_id IS NOT NULL.
// BUG CLASS: N parallel POST create for one paired (client, stylist) all pass the in-tx findFirst,
// then all INSERT; the index lets one win and the losers hit P2002. The handler catches P2002
// (structural isP2002, Turbopack-safe), re-fetches the live winner and returns it (201); count===0
// at re-fetch (winner went terminal) retries the create, bounded to 3 attempts.
//
// RACE: fireParallelSame POST session-container/create x4, looped. Actor = CLIENT; PRECONDITION:
// an ACTIVE ClientStylistPair (seedActivePair), else NOT_PAIRED.
// PROOF (not "no 500" alone): Postgres is read directly: countActiveContainers must be exactly 1
// and every 201 must carry the SAME container id.
// Test: this file (covers 4 parallel creates per loop on a live DB; not higher fan-out).

import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import { fireParallelSame, getData } from '../utils/api-client';
import type { ApiResponse } from '../utils/api-client';
import { dbQuery } from '../utils/db-client';
import { test, assertTrue, assertEqual } from './_harness';
import {
  createEphemeralStylist,
  createEphemeralClient,
  seedActivePair,
  countActiveContainers,
} from './_fixtures';

type CreateData = { session: { id: string; lifecycleState: string } };

/** Extract the container id from a 201 create response (envelope {data:{session}}). */
const containerIdOf = (resp: ApiResponse): string => {
  const data = getData<CreateData>(resp);
  if (
    data == null ||
    data.session == null ||
    typeof data.session.id !== 'string'
  ) {
    throw new Error(
      `unexpected create payload: ${JSON.stringify(resp.body).slice(0, 200)}`
    );
  }
  return data.session.id;
};

/** Remove every container for the pair so each race round genuinely re-races create. */
const resetPair = async (
  clientAccountId: string,
  stylistAccountId: string
): Promise<void> => {
  await dbQuery(
    `DELETE FROM "SessionContainer"
       WHERE client_account_id = $1 AND stylist_account_id = $2`,
    [clientAccountId, stylistAccountId]
  );
};

test(
  'parallel session-container creates for one paired (client,stylist) yield exactly ONE live container, same id',
  async () => {
    const stylist = await createEphemeralStylist('ap-race-stylist');
    const client = await createEphemeralClient('ap-race-client');
    await seedActivePair(client.userId, stylist.accountId);

    const ITER = 12;
    for (let i = 0; i < ITER; i++) {
      // Fresh slot each round → every iteration races the INSERT path (not just the
      // idempotent fast-path after round 1).
      await resetPair(client.clientAccountId, stylist.accountId);

      const responses = await fireParallelSame(
        {
          endpoint: ROUTES_API.SESSION_CONTAINER_CREATE,
          method: 'POST',
          token: client.token,
          body: { stylist_account_id: stylist.accountId },
        },
        4
      );

      // No server error may leak from the race.
      const five = responses.filter(r => r.status >= 500);
      assertTrue(
        five.length === 0,
        `iter ${i}: ${five.length} server error(s): ${JSON.stringify(
          five.map(r => ({ s: r.status, b: r.body })).slice(0, 2)
        )}`
      );

      // Every response must be a 201 success (winner, or idempotent re-fetch of winner).
      const notCreated = responses.filter(r => r.status !== 201);
      assertTrue(
        notCreated.length === 0,
        `iter ${i}: expected all 201, got ${JSON.stringify(
          notCreated.map(r => ({ s: r.status, b: r.body })).slice(0, 2)
        )}`
      );

      // All 201s must reference the SAME container id (idempotent winner).
      const ids = new Set(responses.map(containerIdOf));
      assertTrue(
        ids.size === 1,
        `iter ${i}: parallel creates returned ${ids.size} distinct container ids: ${[...ids].join(', ')}`
      );

      // PROOF on Postgres: exactly one non-terminal container for the pair.
      const live = await countActiveContainers(
        client.clientAccountId,
        stylist.accountId
      );
      assertEqual(
        live,
        1,
        `iter ${i}: live non-terminal container count for the pair`
      );
    }
  },
  'session-container-2 active-pair partial-unique (parallel create idempotent winner)'
);

test(
  'DETERMINISTIC: sequential double-create for one pair is idempotent — one live container, identical id',
  async () => {
    // Sequential (no race): the in-tx findFirst "existing live pair" fast-path MUST
    // return the first container on the second call. A build lacking that guard (or
    // the partial-unique index) would create a SECOND row → countActiveContainers===2
    // (or a 500 on the unique violation): this guard fails RED on the pre-fix code.
    const stylist = await createEphemeralStylist('ap-seq-stylist');
    const client = await createEphemeralClient('ap-seq-client');
    await seedActivePair(client.userId, stylist.accountId);

    const spec = {
      endpoint: ROUTES_API.SESSION_CONTAINER_CREATE,
      method: 'POST' as const,
      token: client.token,
      body: { stylist_account_id: stylist.accountId },
    };

    const [first] = await fireParallelSame(spec, 1);
    assertEqual(
      first.status,
      201,
      `first create status: ${JSON.stringify(first.body)}`
    );
    const firstId = containerIdOf(first);

    const [second] = await fireParallelSame(spec, 1);
    assertEqual(
      second.status,
      201,
      `second create status: ${JSON.stringify(second.body)}`
    );
    const secondId = containerIdOf(second);

    assertEqual(
      secondId,
      firstId,
      'second create must idempotently return the same container id'
    );

    const live = await countActiveContainers(
      client.clientAccountId,
      stylist.accountId
    );
    assertEqual(
      live,
      1,
      'exactly one live non-terminal container after two sequential creates'
    );
  },
  'session-container-2 active-pair idempotency (sequential, deterministic RED guard)'
);

// Tests register on import.
