/**
 * Client domain contract smoke tests
 *
 * Contract tests for client endpoints not covered by existing smoke tests: auth (401), RBAC (403) and
 * body validation (400) boundaries. Covered: CLIENT_GET_CONTACT_FOR_STYLIST (plus HAPPY PATH).
 *
 * Why the happy path is here: the three negatives return 401/403/400 BEFORE the transaction, so
 * the real read path (tx + `lockActivePair` + contact read) would never run, and unit tests mock
 * `$queryRaw`. A nested `Prisma.sql` fragment sent to Postgres as a bind parameter (42601 -> 500) would
 * leave the suite green. Negatives that short-circuit before the work are only apparent coverage.
 * Guard for that class: `npm run nf/prisma-nested-sql`.
 *
 * State is built ONLY through the API (no SQL), like the rest of smoke.
 */

import { test, apiCall, getData, assert } from './_test-utils';
import { ensureActivePair, revokePairQuietly } from './_pair-fixture';
import type { TestContext } from './_test-utils';
import type { CLIENT_DTO_API_V1 } from '@kernel/models/client/client.dto';
import { ROUTES_API } from '@kernel/domain/routing/routing.config';

/**
 * Contact set for the duration of the test and restored in `finally`. Values avoid the characters
 * `sanitizeInput` escapes (`< > " ' /`), otherwise comparing the read with the write would confuse the
 * column write with the contact disclosure.
 */
const PROBE_PHONE = '+48222333444';
const PROBE_EMAIL = 'contract-smoke-client@example.com';

export async function runClientContractTests(ctx: TestContext): Promise<void> {
  // ── CLIENT_GET_CONTACT_FOR_STYLIST ──

  await test('CLIENT_CONTACT_FOR_STYLIST_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint:
        '/api/v1/client/contact/get-for-stylist?client_user_id=fake_user_id',
      method: 'GET',
    });
    assert.status(res, 401);
  });

  await test('CLIENT_CONTACT_FOR_STYLIST_REQUIRES_STYLIST', async () => {
    const res = await apiCall({
      endpoint:
        '/api/v1/client/contact/get-for-stylist?client_user_id=fake_user_id',
      method: 'GET',
      token: ctx.clientToken,
    });
    assert.status(res, 403);
  });

  await test('CLIENT_CONTACT_FOR_STYLIST_VALIDATES_BODY', async () => {
    // No client_user_id in query — handler returns 400
    const res = await apiCall({
      endpoint: '/api/v1/client/contact/get-for-stylist',
      method: 'GET',
      token: ctx.stylistToken,
    });
    assert.status(res, 400);
  });

  // ── HAPPY PATH: para ACTIVE → stylistka widzi kontakt klientki ──
  let stylistAccountId = '';
  let originalContact:
    CLIENT_DTO_API_V1['CLIENT_GET_PROFILE']['RESPONSE'] | null = null;
  let contactOverwritten = false;

  try {
    const pair = await ensureActivePair(ctx);
    stylistAccountId = pair.stylistAccountId;

    // Remember the contact from before the test: other suites read the same row.
    const before = await apiCall({
      endpoint: ROUTES_API.CLIENT_GET_PROFILE,
      method: 'POST',
      token: ctx.clientToken,
      body: {},
    });
    if (before.status === 200) {
      originalContact =
        getData<CLIENT_DTO_API_V1['CLIENT_GET_PROFILE']['RESPONSE']>(before);
    }

    const seed = await apiCall({
      endpoint: ROUTES_API.CLIENT_UPDATE_CONTACT,
      method: 'POST',
      token: ctx.clientToken,
      body: {
        contact_phone: PROBE_PHONE,
        contact_email: PROBE_EMAIL,
      } satisfies CLIENT_DTO_API_V1['CLIENT_UPDATE_CONTACT']['REQUEST'],
    });
    if (seed.status !== 200) {
      throw new Error(`seed client contact failed: ${seed.status}`);
    }
    contactOverwritten = true;

    await test('CLIENT_CONTACT_FOR_STYLIST_RETURNS_PAIRED_CONTACT', async () => {
      const res = await apiCall({
        endpoint: `${ROUTES_API.CLIENT_GET_CONTACT_FOR_STYLIST}?client_user_id=${encodeURIComponent(pair.clientUserId)}`,
        method: 'GET',
        token: ctx.stylistToken,
      });
      // A 500 here means the read transaction is broken.
      assert.status(res, 200);
      const data =
        getData<
          CLIENT_DTO_API_V1['CLIENT_GET_CONTACT_FOR_STYLIST']['RESPONSE']
        >(res);
      // Compare with the SAVED value, not just `hasProperty`: it proves the read went through the lock
      // and the client's row instead of returning an empty DTO.
      assert.equals(
        data.contact_phone,
        PROBE_PHONE,
        'stylist must see the phone the paired client saved'
      );
      assert.equals(
        data.contact_email,
        PROBE_EMAIL,
        'stylist must see the email the paired client saved'
      );
      // client_name is the client's `users.name`. TEST_USERS_CONFIG.CLIENT has no `display_name` (SSOT),
      // so an empty string is LEGAL here: check the field's type and presence; the phone and e-mail
      // above prove the row was read.
      assert.hasProperty(data, 'client_name');
      assert.equals(
        typeof data.client_name,
        'string',
        'client_name must be a string'
      );
    });

    // The same transaction from the other side: after unpairing the read MUST go quiet. Without this the
    // 200 above does not prove the pair gate works at all.
    await revokePairQuietly(ctx, stylistAccountId);
    stylistAccountId = '';

    await test('CLIENT_CONTACT_FOR_STYLIST_STOPS_AFTER_REVOKE', async () => {
      const res = await apiCall({
        endpoint: `${ROUTES_API.CLIENT_GET_CONTACT_FOR_STYLIST}?client_user_id=${encodeURIComponent(pair.clientUserId)}`,
        method: 'GET',
        token: ctx.stylistToken,
      });
      assert.equals(
        res.status >= 400 && res.status < 500,
        true,
        `revoked pairing must stop the contact reveal with 4xx, got ${res.status}`
      );
    });
  } finally {
    if (contactOverwritten && originalContact) {
      await apiCall({
        endpoint: ROUTES_API.CLIENT_UPDATE_CONTACT,
        method: 'POST',
        token: ctx.clientToken,
        body: {
          contact_phone: originalContact.contact_phone,
          contact_email: originalContact.contact_email,
        } satisfies CLIENT_DTO_API_V1['CLIENT_UPDATE_CONTACT']['REQUEST'],
      }).catch(() => {
        /* cleanup must not mask the error of the real test */
      });
    }
    await revokePairQuietly(ctx, stylistAccountId);
  }
}
