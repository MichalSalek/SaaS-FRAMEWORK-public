// tests/concurrency/ban-user-state.concurrency.ts
//
// FAMILY 3 — BAN ⊥ user-state disable (both User-first writers).
//
// THE SHAPE: two admin paths deactivate the SAME stylist's User row:
//   • disableUser_IO (USER_DISABLE_ANY) — idempotent updateMany WHERE disabled_at:null
//     (sets is_active=false + disabled_at ONCE; re-disable = no-op, timestamp survives).
//   • resolveContentReport_IO action=BAN (ADMIN_RESOLVE_REPORT) — flips the gallery-record
//     owner's User row to is_active=false + disabled_at inside the moderation $transaction.
//
// THE INVARIANT (must ALWAYS hold; never a 5xx, never a torn write):
//   after BAN ⊥ disable on the same user → is_active=false, disabled_at SET (non-null),
//   deleted_at UNTOUCHED (null — a ban/disable is NOT a soft-delete; §13.1 deleted_at is
//   the soft-delete marker, never set by these paths).
//
// THE IDEMPOTENCY GUARD (deterministic, RED on a naive non-idempotent writer):
//   disable first (disabled_at := T1), THEN ban. The earliest disabled_at must SURVIVE —
//   a writer that does an UNCONDITIONAL `user.update {disabled_at: new Date()}` overwrites
//   T1 with a later timestamp (lost first-ban-time + would re-emit a USER_DISABLED audit).
//   Parity with disableUser_IO's guarded updateMany WHERE disabled_at:null.
//
// Both flows acquire row locks User→StylistAccount (global lock-order, see the LOCK ORDER
// DECISION in disableSelfUser_IO / moderation-admin.operations) so the race serializes and
// never deadlocks (40P01 ⇒ a 500, which assertNo500 would catch).

import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import { fireParallel, apiCallRaw, getAdminToken } from '../utils/api-client';
import { test, assertTrue, assertNo500 } from './_harness';
import {
  createEphemeralStylist,
  createEphemeralClient,
  seedGalleryRecord,
  seedContentReport,
  readUserState,
} from './_fixtures';

test(
  'BAN racing admin-disable on the same user: is_active=false, disabled_at set, deleted_at untouched, no 5xx',
  async () => {
    const adminToken = await getAdminToken();
    const client = await createEphemeralClient('ban-reporter');
    const ITER = 12;

    for (let i = 0; i < ITER; i++) {
      // Fresh target + fresh PENDING report each round: a banned/disabled user and a
      // once-resolvable report make every iteration a faithful first-time race.
      const target = await createEphemeralStylist('ban-target');
      const recordId = await seedGalleryRecord(target.accountId);
      const reportId = await seedContentReport(client.userId, recordId);

      const responses = await fireParallel([
        {
          endpoint: ROUTES_API.ADMIN_RESOLVE_REPORT,
          method: 'POST',
          token: adminToken,
          body: { report_id: reportId, action: 'BAN' },
        },
        {
          endpoint: ROUTES_API.USER_DISABLE_ANY,
          method: 'POST',
          token: adminToken,
          body: { id: target.userId },
        },
      ]);

      assertNo500(responses);

      const state = await readUserState(target.userId);
      if (state == null) {
        throw new Error(`iter ${i}: user vanished`);
      }
      assertTrue(
        state.is_active === false,
        `iter ${i}: expected is_active=false, got ${state.is_active} (resp=${JSON.stringify(
          responses.map(r => r.status)
        )})`
      );
      assertTrue(
        state.disabled_at !== null,
        `iter ${i}: expected disabled_at SET, got null (resp=${JSON.stringify(
          responses.map(r => r.status)
        )})`
      );
      assertTrue(
        state.deleted_at === null,
        `iter ${i}: ban/disable soft-DELETED the user — deleted_at=${String(
          state.deleted_at
        )} (must stay null)`
      );
    }
  },
  'ban-user-state-1 BAN ⊥ disable: no torn state, deleted_at untouched'
);

test(
  'disable-then-BAN is idempotent on disabled_at: earliest timestamp survives (no overwrite)',
  async () => {
    const adminToken = await getAdminToken();
    const target = await createEphemeralStylist('ban-idem-target');
    const client = await createEphemeralClient('ban-idem-reporter');
    const recordId = await seedGalleryRecord(target.accountId);
    const reportId = await seedContentReport(client.userId, recordId);

    // 1. Disable first — sets disabled_at := T1 (guarded updateMany WHERE disabled_at:null).
    const disableResp = await apiCallRaw({
      endpoint: ROUTES_API.USER_DISABLE_ANY,
      method: 'POST',
      token: adminToken,
      body: { id: target.userId },
    });
    assertTrue(
      disableResp.status < 500,
      `disable returned ${disableResp.status}: ${JSON.stringify(disableResp.body)}`
    );

    const afterDisable = await readUserState(target.userId);
    if (afterDisable == null || afterDisable.disabled_at == null) {
      throw new Error(
        `disable did not set disabled_at: ${JSON.stringify(afterDisable)}`
      );
    }
    const t1 = afterDisable.disabled_at.getTime();

    // 2. BAN the (already-disabled) user — must NOT overwrite the first disabled_at.
    const banResp = await apiCallRaw({
      endpoint: ROUTES_API.ADMIN_RESOLVE_REPORT,
      method: 'POST',
      token: adminToken,
      body: { report_id: reportId, action: 'BAN' },
    });
    assertTrue(
      banResp.status < 500,
      `ban returned ${banResp.status}: ${JSON.stringify(banResp.body)}`
    );

    const afterBan = await readUserState(target.userId);
    if (afterBan == null || afterBan.disabled_at == null) {
      throw new Error(`user lost disabled_at after ban: ${JSON.stringify(afterBan)}`);
    }
    assertTrue(
      afterBan.disabled_at.getTime() === t1,
      `disabled_at OVERWRITTEN by BAN: was ${new Date(t1).toISOString()}, now ${afterBan.disabled_at.toISOString()} (non-idempotent writer)`
    );
    assertTrue(
      afterBan.is_active === false,
      `expected is_active=false after ban, got ${afterBan.is_active}`
    );
    assertTrue(
      afterBan.deleted_at === null,
      `ban soft-DELETED the user — deleted_at must stay null, got ${String(afterBan.deleted_at)}`
    );
  },
  'ban-user-state-2 disable→BAN idempotency: disabled_at set once, never overwritten'
);

// Tests register on import.
