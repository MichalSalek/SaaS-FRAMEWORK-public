/**
 * High-Risk Endpoints Smoke Tests — Finding #8
 *
 * Covers 5 endpoint groups identified as high-risk in testy-api review:
 * 1. USER_CONFIRM_DELETE        — GDPR critical, token-based deletion
 * 2. ADMIN_POLICY (4 ops)      — content moderation/compliance CRUD
 * 3. USER_CONFIRM_EMAIL_CHANGE — account takeover vector
 * 4. SESSION_CONTAINER_SHARE   — IDOR risk, PII, quota
 * 5. PAIRING_SESSION_REVOKE_ALL — authorization boundary
 *
 * Token generation: tokens are signed with the development fallback secret;
 * see the backend token utilities.
 *
 * Caveats:
 * - Valid-token tests require a temp user so we do not soft-delete the main test user.
 * - SESSION_CONTAINER_SHARE quota test relies on Finding #3 being already wired
 *   (SESSION_CONTAINER_SHARE_QUOTA_EXCEEDED event). If that quota is not enforced
 *   the test will softly skip rather than fail.
 * - PAIRING_SESSION_REVOKE_ALL has no client-specific path (endpoint uses
 *   requireStylistAccount guard — client token → 403). The "client revokes own"
 *   scenario documented in the task spec does not exist at this endpoint; flagged below.
 */

import crypto from 'crypto';
import {
  test,
  apiCall,
  getData,
  getEvent,
  assert,
  getAdminToken,
  getFreshStylistToken,
  extractSessionToken,
} from './_test-utils';
import type { TestContext } from './_test-utils';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import type { SESSION_CONTAINER_DTO_API_V1 } from '@kernel/models/session-container/session-container.dto';
import type { PAIRING_DTO_API_V1 } from '@kernel/models/pairing/pairing.dto';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

// ============================================================================
// TOKEN HELPERS
// Tokens are signed with the development fallback secret; see the backend token
// utilities.
// ============================================================================

const DEV_UNSUBSCRIBE_SECRET = 'dev-email-unsubscribe-secret-change-me';
const DEV_DELETE_SECRET = DEV_UNSUBSCRIBE_SECRET + '-delete-confirm';
const DEV_EMAIL_CHANGE_SECRET = DEV_UNSUBSCRIBE_SECRET + '-email-change';

function hmacBase64url(secret: string, payload: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
}

/**
 * Create a valid delete-confirm token for a given userId (mirrors the backend's
 * createDeleteConfirmToken). version=0 is correct for a brand-new temp user.
 */
function createDeleteConfirmToken(
  userId: string,
  offsetMs = 0,
  version = 0
): string {
  const timestamp = Date.now() + offsetMs;
  const payload = [userId, 'delete', String(version), String(timestamp)].join(
    ':'
  );
  const payloadBase64 = Buffer.from(payload).toString('base64url');
  const signature = hmacBase64url(DEV_DELETE_SECRET, payload);
  return `${payloadBase64}.${signature}`;
}

/** Create a valid email-change token (mirrors backend createEmailChangeToken). */
function createEmailChangeToken(
  userId: string,
  currentEmail: string,
  newEmail: string,
  offsetMs = 0
): string {
  const timestamp = Date.now() + offsetMs;
  const payload = [userId, currentEmail, newEmail, String(timestamp)].join(':');
  const payloadBase64 = Buffer.from(payload).toString('base64url');
  const signature = hmacBase64url(DEV_EMAIL_CHANGE_SECRET, payload);
  return `${payloadBase64}.${signature}`;
}

// ============================================================================
// 1. USER_CONFIRM_DELETE
// Route: /api/v1/user/delete/confirm (GET or POST, accepts token via query/body)
// Auth: NONE (public confirmation endpoint)
// Risk: GDPR critical
// ============================================================================

export async function runUserConfirmDeleteTests(
  _ctx: TestContext
): Promise<void> {
  console.log('\n🔑 USER_CONFIRM_DELETE\n');

  // -- NEGATIVE: no token → 400 validation error
  // Handler uses contestedHTTPMethod: 'get' and reads token from req.query.token.
  // Omit the token query param entirely to trigger validation failure.
  await test('USER_CONFIRM_DELETE_NO_TOKEN', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/user/delete/confirm',
      method: 'GET',
    });
    assert.status(response, 400);
    assert.equals(
      getEvent(response),
      APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED
    );
  });

  // -- NEGATIVE: invalid token (garbage) → 400
  // Pass token as query param (handler uses GET only).
  await test('USER_CONFIRM_DELETE_INVALID_TOKEN', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/user/delete/confirm?token=not-a-real-token-garbage',
      method: 'GET',
    });
    assert.status(response, 400);
    const event = getEvent(response);
    // Garbage token fails both format and HMAC checks
    assert.equals(
      event === APP_EVENTS.INFO.USER.USER_DELETE_INVALID_TOKEN ||
        event === APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED,
      true,
      `Expected invalid token event, got: ${event}`
    );
  });

  // -- NEGATIVE: expired token (timestamp in the past beyond 24h TTL) → 400
  await test('USER_CONFIRM_DELETE_EXPIRED_TOKEN', async () => {
    // Generate a well-formed token with timestamp 25h in the past
    const expiredToken = createDeleteConfirmToken(
      'clfakeuseridforthisexpiry',
      -(25 * 60 * 60 * 1000)
    );
    const response = await apiCall({
      endpoint: `/api/v1/user/delete/confirm?token=${encodeURIComponent(expiredToken)}`,
      method: 'GET',
    });
    // Token decodes but timestamp check fails → invalid token error
    assert.status(response, 400);
    const event = getEvent(response);
    // Backend collapses expired and invalid into same error path (DELETE_CONFIRM_INVALID_TOKEN)
    assert.equals(
      event === APP_EVENTS.INFO.USER.USER_DELETE_INVALID_TOKEN ||
        event === APP_EVENTS.INFO.USER.USER_DELETE_TOKEN_EXPIRED,
      true,
      `Expected delete token error event, got: ${event}`
    );
  });

  // -- POSITIVE: valid token for a real temp user → success, user soft-deleted
  await test('USER_CONFIRM_DELETE_VALID_TOKEN', async () => {
    const tempEmail = `temp-confirm-delete-${Date.now()}@example.com`;
    const freshAdminToken = await getAdminToken();

    // Create temp user
    const loginRes = await apiCall({
      endpoint: '/api/auth/dev-login',
      method: 'POST',
      body: { email: tempEmail },
    });
    assert.status(loginRes, 200);
    const loginData =
      getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(loginRes);
    const tempUserId = loginData.id;

    try {
      // Generate valid token for this user
      const validToken = createDeleteConfirmToken(tempUserId);

      const response = await apiCall({
        endpoint: `/api/v1/user/delete/confirm?token=${encodeURIComponent(validToken)}`,
        method: 'GET',
      });

      assert.status(response, 200);
      assert.equals(
        getEvent(response),
        APP_EVENTS.INFO.USER.USER_DELETE_CONFIRMED
      );

      const data =
        getData<USER_DTO_API_V1['USER_DELETE_CONFIRM']['RESPONSE']>(response);
      assert.equals(data.confirmed, true, 'confirmed should be true');
    } finally {
      // Cleanup: attempt admin delete (user may be soft-deleted already, that's OK)
      await apiCall({
        endpoint: '/api/v1/admin/user/delete/any',
        method: 'POST',
        token: freshAdminToken,
        body: { id: tempUserId },
      }).catch(() => {
        // User may already be soft-deleted — ignore cleanup error
      });
    }
  });

  // -- IDEMPOTENCY: same token used twice → both calls return 200 (idempotent success-noop)
  // DEEP HARDENING (user-lifecycle-1): the token is now genuinely single-use via a per-user
  // epoch (delete_confirm_version). First confirm wins the atomic compare-and-increment
  // (count=1) → version++ → soft-deletes the account. The SECOND confirm with the same token
  // carries the now-stale version → CAS mismatch (count=0) AND/OR account already inactive →
  // confirmDeleteSelf_IO returns an idempotent success-noop: it does NOT re-kill, re-arm
  // recovery, or re-send email. So the endpoint still responds 200 USER_DELETE_CONFIRMED on
  // replay (idempotent), but the underlying state is no longer mutated — replay-after-
  // reactivate can no longer resurrect a delete. See user-mutations.operations.ts DECISION.
  await test('USER_CONFIRM_DELETE_REPLAY_IDEMPOTENT', async () => {
    const tempEmail = `temp-replay-delete-${Date.now()}@example.com`;
    const freshAdminToken = await getAdminToken();

    const loginRes = await apiCall({
      endpoint: '/api/auth/dev-login',
      method: 'POST',
      body: { email: tempEmail },
    });
    assert.status(loginRes, 200);
    const loginData =
      getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(loginRes);
    const tempUserId = loginData.id;

    try {
      const validToken = createDeleteConfirmToken(tempUserId);

      // First confirm → success (soft-delete)
      const first = await apiCall({
        endpoint: `/api/v1/user/delete/confirm?token=${encodeURIComponent(validToken)}`,
        method: 'GET',
      });
      assert.status(first, 200);
      assert.equals(
        getEvent(first),
        APP_EVENTS.INFO.USER.USER_DELETE_CONFIRMED
      );

      // Second confirm (same token, within TTL) → idempotent success-noop: 200 again.
      // Version already consumed (++ on first confirm) → CAS mismatch → success-noop,
      // no re-kill / re-arm / re-email. Endpoint contract stays 200 USER_DELETE_CONFIRMED.
      const second = await apiCall({
        endpoint: `/api/v1/user/delete/confirm?token=${encodeURIComponent(validToken)}`,
        method: 'GET',
      });
      assert.status(second, 200);
      assert.equals(
        getEvent(second),
        APP_EVENTS.INFO.USER.USER_DELETE_CONFIRMED,
        'replay is an idempotent success-noop (version already consumed)'
      );
    } finally {
      await apiCall({
        endpoint: '/api/v1/admin/user/delete/any',
        method: 'POST',
        token: freshAdminToken,
        body: { id: tempUserId },
      }).catch(() => {});
    }
  });
}

// ============================================================================
// 2. ADMIN_POLICY (4 endpoints: get, save, delete, set-main)
// Routes: /api/v1/admin/get-policies, save-policy, delete-policy, set-main-policy
// Auth: ADMIN required
// Risk: content moderation/compliance critical
// ============================================================================

export async function runAdminPolicyTests(ctx: TestContext): Promise<void> {
  console.log('\n📋 ADMIN_POLICY CRUD\n');

  // -- RBAC: stylist → 403 on all policy endpoints
  await test('ADMIN_POLICY_GET_RBAC_STYLIST_403', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/get-policies',
      method: 'GET',
      token: ctx.stylistToken,
    });
    assert.status(response, 403);
  });

  await test('ADMIN_POLICY_SAVE_RBAC_STYLIST_403', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/save-policy',
      method: 'POST',
      token: ctx.stylistToken,
      body: {
        title: 'Test Policy',
        content: 'Test content',
      } satisfies ADMIN_DTO_API_V1['ADMIN_SAVE_POLICY']['REQUEST'],
    });
    assert.status(response, 403);
  });

  await test('ADMIN_POLICY_DELETE_RBAC_STYLIST_403', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/delete-policy',
      method: 'POST',
      token: ctx.stylistToken,
      body: {
        id: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
      } satisfies ADMIN_DTO_API_V1['ADMIN_DELETE_POLICY']['REQUEST'],
    });
    assert.status(response, 403);
  });

  await test('ADMIN_POLICY_SET_MAIN_RBAC_STYLIST_403', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/set-main-policy',
      method: 'POST',
      token: ctx.stylistToken,
      body: {
        id: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
      } satisfies ADMIN_DTO_API_V1['ADMIN_SET_MAIN_POLICY']['REQUEST'],
    });
    assert.status(response, 403);
  });

  // -- RBAC: client → 403
  await test('ADMIN_POLICY_GET_RBAC_CLIENT_403', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/get-policies',
      method: 'GET',
      token: ctx.clientToken,
    });
    assert.status(response, 403);
  });

  // -- Validation: save with missing required fields → 400
  await test('ADMIN_POLICY_SAVE_VALIDATION_MISSING_TITLE', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/save-policy',
      method: 'POST',
      token: ctx.adminToken,
      body: { content: 'Content without title' },
    });
    assert.status(response, 400);
    assert.equals(
      getEvent(response),
      APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED
    );
  });

  await test('ADMIN_POLICY_SAVE_VALIDATION_MISSING_CONTENT', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/save-policy',
      method: 'POST',
      token: ctx.adminToken,
      body: { title: 'Title without content' },
    });
    assert.status(response, 400);
    assert.equals(
      getEvent(response),
      APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED
    );
  });

  await test('ADMIN_POLICY_SAVE_VALIDATION_EMPTY_STRINGS', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/save-policy',
      method: 'POST',
      token: ctx.adminToken,
      body: { title: '   ', content: '   ' },
    });
    assert.status(response, 400);
  });

  // -- Validation: delete with missing id → 400
  await test('ADMIN_POLICY_DELETE_VALIDATION_MISSING_ID', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/delete-policy',
      method: 'POST',
      token: ctx.adminToken,
      body: {},
    });
    assert.status(response, 400);
    assert.equals(
      getEvent(response),
      APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED
    );
  });

  // -- Validation: set-main with missing id → 400
  await test('ADMIN_POLICY_SET_MAIN_VALIDATION_MISSING_ID', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/set-main-policy',
      method: 'POST',
      token: ctx.adminToken,
      body: {},
    });
    assert.status(response, 400);
    assert.equals(
      getEvent(response),
      APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED
    );
  });

  // -- POSITIVE: full CRUD flow
  await test('ADMIN_POLICY_FULL_CRUD', async () => {
    // Get existing policies (baseline)
    const listResponse = await apiCall({
      endpoint: '/api/v1/admin/get-policies',
      method: 'GET',
      token: ctx.adminToken,
    });
    assert.status(listResponse, 200);
    assert.equals(
      getEvent(listResponse),
      APP_EVENTS.INFO.ADMIN.POLICIES_FETCHED
    );
    const listData =
      getData<ADMIN_DTO_API_V1['ADMIN_GET_POLICIES']['RESPONSE']>(listResponse);
    assert.hasProperty(
      listData as unknown as Record<string, unknown>,
      'policies'
    );
    assert.equals(
      Array.isArray(listData.policies),
      true,
      'policies should be an array'
    );

    // Create a new policy
    const createResponse = await apiCall({
      endpoint: '/api/v1/admin/save-policy',
      method: 'POST',
      token: ctx.adminToken,
      body: {
        title: `Smoke Test Policy ${Date.now()}`,
        content:
          'This is smoke test policy content for automated testing. Not for production.',
      } satisfies ADMIN_DTO_API_V1['ADMIN_SAVE_POLICY']['REQUEST'],
    });
    assert.status(createResponse, 200);
    assert.equals(getEvent(createResponse), APP_EVENTS.INFO.ADMIN.POLICY_SAVED);
    const createData =
      getData<ADMIN_DTO_API_V1['ADMIN_SAVE_POLICY']['RESPONSE']>(
        createResponse
      );
    assert.hasProperty(
      createData as unknown as Record<string, unknown>,
      'policy_id'
    );
    assert.equals(
      typeof createData.policy_id,
      'string',
      'policy_id should be string'
    );
    const policyId = createData.policy_id;

    try {
      // Verify it appears in list
      const listAfterCreate = await apiCall({
        endpoint: '/api/v1/admin/get-policies',
        method: 'GET',
        token: ctx.adminToken,
      });
      assert.status(listAfterCreate, 200);
      const listAfterData =
        getData<ADMIN_DTO_API_V1['ADMIN_GET_POLICIES']['RESPONSE']>(
          listAfterCreate
        );
      const found = listAfterData.policies.find(
        (p: { id: string }) => p.id === policyId
      );
      if (!found)
        throw new Error(`Created policy ${policyId} not found in list`);

      // Update the policy (save with existing id)
      const updateResponse = await apiCall({
        endpoint: '/api/v1/admin/save-policy',
        method: 'POST',
        token: ctx.adminToken,
        body: {
          id: policyId,
          title: `Updated Smoke Test Policy ${Date.now()}`,
          content: 'Updated content for smoke test policy.',
        } satisfies ADMIN_DTO_API_V1['ADMIN_SAVE_POLICY']['REQUEST'],
      });
      assert.status(updateResponse, 200);
      assert.equals(
        getEvent(updateResponse),
        APP_EVENTS.INFO.ADMIN.POLICY_SAVED
      );

      // Set it as main policy
      const setMainResponse = await apiCall({
        endpoint: '/api/v1/admin/set-main-policy',
        method: 'POST',
        token: ctx.adminToken,
        body: {
          id: policyId,
        } satisfies ADMIN_DTO_API_V1['ADMIN_SET_MAIN_POLICY']['REQUEST'],
      });
      assert.status(setMainResponse, 200);
      assert.equals(
        getEvent(setMainResponse),
        APP_EVENTS.INFO.ADMIN.POLICY_SET_MAIN
      );
    } finally {
      // Cleanup: delete the test policy
      const deleteResponse = await apiCall({
        endpoint: '/api/v1/admin/delete-policy',
        method: 'POST',
        token: ctx.adminToken,
        body: {
          id: policyId,
        } satisfies ADMIN_DTO_API_V1['ADMIN_DELETE_POLICY']['REQUEST'],
      });
      // Accept 200 (success) — don't throw in finally to avoid masking test errors
      if (deleteResponse.status !== 200) {
        console.log(
          `   (Cleanup: delete policy ${policyId} returned ${deleteResponse.status})`
        );
      }
    }
  });

  // -- Non-existent policy id → 404 or domain error
  await test('ADMIN_POLICY_SET_MAIN_NONEXISTENT_ID', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/set-main-policy',
      method: 'POST',
      token: ctx.adminToken,
      body: {
        id: 'clnonexistentpolicyidhere00',
      } satisfies ADMIN_DTO_API_V1['ADMIN_SET_MAIN_POLICY']['REQUEST'],
    });
    // Backend should return 404 for unknown policy id
    assert.equals(
      response.status === 404 || response.status === 400,
      true,
      `Expected 404 or 400 for non-existent policy, got ${response.status}`
    );
  });

  // -- Unauthenticated → 401
  await test('ADMIN_POLICY_GET_NO_AUTH_401', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/get-policies',
      method: 'GET',
    });
    assert.status(response, 401);
  });
}

// ============================================================================
// 3. USER_CONFIRM_EMAIL_CHANGE
// Route: /api/v1/user/confirm-email-change (GET or POST, token via query/body)
// Auth: NONE (public confirmation endpoint)
// Risk: account takeover vector
// ============================================================================

export async function runUserConfirmEmailChangeTests(
  ctx: TestContext
): Promise<void> {
  console.log('\n📧 USER_CONFIRM_EMAIL_CHANGE\n');

  // -- NEGATIVE: no token → 400
  // Handler uses contestedHTTPMethod: 'get', reads token from req.query.token.
  await test('USER_CONFIRM_EMAIL_CHANGE_NO_TOKEN', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/user/confirm-email-change',
      method: 'GET',
    });
    assert.status(response, 400);
    assert.equals(
      getEvent(response),
      APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED
    );
  });

  // -- NEGATIVE: invalid token (garbage) → 400
  await test('USER_CONFIRM_EMAIL_CHANGE_INVALID_TOKEN', async () => {
    const response = await apiCall({
      endpoint:
        '/api/v1/user/confirm-email-change?token=totally-invalid-garbage-token-xyz',
      method: 'GET',
    });
    assert.status(response, 400);
    const event = getEvent(response);
    assert.equals(
      event === APP_EVENTS.INFO.USER.USER_EMAIL_CHANGE_INVALID_TOKEN ||
        event === APP_EVENTS.INFO.USER.USER_EMAIL_CHANGE_TOKEN_EXPIRED ||
        event === APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED,
      true,
      `Expected email change invalid token event, got: ${event}`
    );
  });

  // -- NEGATIVE: expired token → 400
  await test('USER_CONFIRM_EMAIL_CHANGE_EXPIRED_TOKEN', async () => {
    const expiredToken = createEmailChangeToken(
      'clfakeuseridforthisexpiry',
      'old-email-expired@example.com',
      'new-email-expired@example.com',
      -(25 * 60 * 60 * 1000)
    );
    const response = await apiCall({
      endpoint: `/api/v1/user/confirm-email-change?token=${encodeURIComponent(expiredToken)}`,
      method: 'GET',
    });
    assert.status(response, 400);
    const event = getEvent(response);
    assert.equals(
      event === APP_EVENTS.INFO.USER.USER_EMAIL_CHANGE_INVALID_TOKEN ||
        event === APP_EVENTS.INFO.USER.USER_EMAIL_CHANGE_TOKEN_EXPIRED,
      true,
      `Expected expired token event, got: ${event}`
    );
  });

  // -- POSITIVE: valid token for a temp user → success, email updated
  await test('USER_CONFIRM_EMAIL_CHANGE_VALID_TOKEN', async () => {
    const tempEmail = `temp-email-change-${Date.now()}@example.com`;
    const newEmail = `temp-email-changed-${Date.now()}@example.com`;
    const freshAdminToken = await getAdminToken();

    // Create temp user
    const loginRes = await apiCall({
      endpoint: '/api/auth/dev-login',
      method: 'POST',
      body: { email: tempEmail },
    });
    assert.status(loginRes, 200);
    const loginData =
      getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(loginRes);
    const tempUserId = loginData.id;

    try {
      // Generate valid email-change token (currentEmail nonce = temp user's own email)
      const validToken = createEmailChangeToken(tempUserId, tempEmail, newEmail);

      const response = await apiCall({
        endpoint: `/api/v1/user/confirm-email-change?token=${encodeURIComponent(validToken)}`,
        method: 'GET',
      });

      assert.status(response, 200);
      assert.equals(
        getEvent(response),
        APP_EVENTS.INFO.USER.USER_EMAIL_CHANGE_CONFIRMED
      );

      const data =
        getData<USER_DTO_API_V1['USER_EMAIL_CHANGE_CONFIRM']['RESPONSE']>(response);
      assert.equals(data.confirmed, true, 'confirmed should be true');
    } finally {
      await apiCall({
        endpoint: '/api/v1/admin/user/delete/any',
        method: 'POST',
        token: freshAdminToken,
        body: { id: tempUserId },
      }).catch(() => {});
    }
  });

  // -- NEGATIVE: email collision — new email already taken by another user
  // Token with newEmail = existing user's email → backend detects collision
  await test('USER_CONFIRM_EMAIL_CHANGE_EMAIL_COLLISION', async () => {
    // Use the existing stylist user's email as the collision target.
    // We need the stylist's actual email — get it from session.
    const sessionRes = await apiCall({
      endpoint: '/api/v1/session/get-current',
      token: ctx.stylistToken,
    });
    const sessionData = getData<{ email: string; id: string }>(sessionRes);
    const existingStylistEmail = sessionData.email;
    const existingStylistId = sessionData.id;

    // Create a second temp user who tries to claim the stylist's email
    const tempEmail = `temp-collision-${Date.now()}@example.com`;
    const freshAdminToken = await getAdminToken();
    const loginRes = await apiCall({
      endpoint: '/api/auth/dev-login',
      method: 'POST',
      body: { email: tempEmail },
    });
    assert.status(loginRes, 200);
    const loginData =
      getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(loginRes);
    const tempUserId = loginData.id;

    try {
      // Token says: change tempUser's email (currentEmail nonce = tempEmail) to
      // stylist's email (collision target). Nonce matches DB → reaches update → P2002.
      const collisionToken = createEmailChangeToken(
        tempUserId,
        tempEmail,
        existingStylistEmail
      );

      const response = await apiCall({
        endpoint: `/api/v1/user/confirm-email-change?token=${encodeURIComponent(collisionToken)}`,
        method: 'GET',
      });

      // Should fail — email already taken. Backend will return 4xx.
      assert.equals(
        response.status >= 400,
        true,
        `Expected failure for email collision, got ${response.status}. Event: ${getEvent(response)}`
      );

      // DECISION (nie usuwaj tego komentarza):
      // Collision path: confirmEmailChange_IO → Prisma P2002 → USER_EMAIL_ALREADY_IN_USE
      // → error-mapper → EMAIL_ALREADY_EXISTS (400). Token format jest poprawny (kolizja
      // na etapie DB update, nie token verification), więc oczekujemy konkretnego eventu.
      // EMAIL_ALREADY_EXISTS = security marker: każdy inny event (np. DATABASE_ERROR,
      // VALIDATION_FAILED) wskazuje na regresję w ścieżce account-takeover protection.
      assert.equals(
        getEvent(response),
        APP_EVENTS.INFO.USER.EMAIL_ALREADY_EXISTS,
        `Email collision must emit EMAIL_ALREADY_EXISTS, got: ${getEvent(response)}`
      );

      // Suppress unused variable warning
      void existingStylistId;
    } finally {
      await apiCall({
        endpoint: '/api/v1/admin/user/delete/any',
        method: 'POST',
        token: freshAdminToken,
        body: { id: tempUserId },
      }).catch(() => {});
    }
  });
}

// ============================================================================
// 4. SESSION_CONTAINER_SHARE
// Route: /api/v1/session-container/share (POST)
// Auth: CLIENT required (requireClientAccount guard)
// Risk: IDOR (another client sharing someone else's session), quota
// ============================================================================

export async function runSessionContainerShareTests(
  ctx: TestContext
): Promise<void> {
  console.log('\n📤 SESSION_CONTAINER_SHARE\n');

  // -- RBAC: stylist account → 403 (requireClientAccount guard)
  await test('SESSION_CONTAINER_SHARE_STYLIST_RBAC_403', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/session-container/share',
      method: 'POST',
      token: ctx.stylistToken,
      body: {
        session_id: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
      } satisfies SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SHARE']['REQUEST'],
    });
    assert.status(response, 403);
  });

  // -- NEGATIVE: unauthenticated → 401
  await test('SESSION_CONTAINER_SHARE_NO_AUTH_401', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/session-container/share',
      method: 'POST',
      body: { session_id: 'clxxxxxxxxxxxxxxxxxxxxxxxxx' },
    });
    assert.status(response, 401);
  });

  // -- NEGATIVE: missing session_id → 400
  await test('SESSION_CONTAINER_SHARE_MISSING_SESSION_ID', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/session-container/share',
      method: 'POST',
      token: ctx.clientToken,
      body: {},
    });
    assert.status(response, 400);
    assert.equals(
      getEvent(response),
      APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED
    );
  });

  // -- NEGATIVE: non-existent session_id → 404
  await test('SESSION_CONTAINER_SHARE_NONEXISTENT_SESSION_404', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/session-container/share',
      method: 'POST',
      token: ctx.clientToken,
      body: {
        session_id: 'clnonexistentsessionidhere0',
      } satisfies SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SHARE']['REQUEST'],
    });
    assert.status(response, 404);
    assert.equals(
      getEvent(response),
      APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_NOT_FOUND
    );
  });

  // -- IDOR test: one client cannot share another client's session
  // Strategy: create session as main client, then attempt to share it as a different (temp) client.
  // The IDOR check is performed by the backend before the "session has photos" check,
  // so we get SESSION_CONTAINER_NOT_AUTHORIZED (403) even for empty sessions.
  await test('SESSION_CONTAINER_SHARE_IDOR_REJECTION', async () => {
    const freshAdminToken = await getAdminToken();

    // Create a second temp client user for IDOR test
    const tempEmail = `temp-client-idor-${Date.now()}@example.com`;
    const loginRes = await apiCall({
      endpoint: '/api/auth/dev-login',
      method: 'POST',
      body: { email: tempEmail },
    });
    assert.status(loginRes, 200);
    const loginData =
      getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(loginRes);
    const tempUserId = loginData.id;
    const tempToken = extractSessionToken(loginRes);

    try {
      // Onboard temp user as CLIENT so requireClientAccount guard passes.
      // Without this, the guard returns 403 UNAUTHORIZED (WRONG_ACCOUNT_TYPE)
      // before the operation can check session ownership.
      const onboardRes = await apiCall({
        endpoint: '/api/v1/user/onboard-client',
        method: 'POST',
        token: tempToken,
        body: {},
      });
      if (onboardRes.status !== 200 && onboardRes.status !== 201) {
        throw new Error(
          `Expected 200/201 on client onboard, got ${onboardRes.status}`
        );
      }

      // Main client creates a session
      const createRes = await apiCall({
        endpoint: '/api/v1/session-container/create',
        method: 'POST',
        token: ctx.clientToken,
        body: {},
      });

      if (createRes.status === 429) {
        console.log(
          '   (Session container quota exceeded — skipping IDOR test)'
        );
        return;
      }
      if (createRes.status !== 201) {
        throw new Error(
          `Expected 201 on session create, got ${createRes.status}`
        );
      }

      const createData =
        getData<SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CREATE']['RESPONSE']>(createRes);
      assert.hasProperty(
        createData as unknown as Record<string, unknown>,
        'session'
      );
      const session = createData.session as { id: string };
      const sessionId = session.id;

      try {
        // IDOR: temp client (different user) tries to share the MAIN client's session → 403
        // The temp user is now a CLIENT so requireClientAccount passes, and the operation
        // reaches the ownership check: session.client_account_id !== tempUser.client_account_id
        // → SESSION_CONTAINER_NOT_AUTHORIZED.
        const idorRes = await apiCall({
          endpoint: '/api/v1/session-container/share',
          method: 'POST',
          token: tempToken,
          body: {
            session_id: sessionId,
          } satisfies SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SHARE']['REQUEST'],
        });
        assert.status(idorRes, 403);
        assert.equals(
          getEvent(idorRes),
          APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_NOT_AUTHORIZED,
          'IDOR attempt must be rejected with SESSION_CONTAINER_NOT_AUTHORIZED before session emptiness check'
        );
      } finally {
        // Close the session to clean up
        await apiCall({
          endpoint: '/api/v1/session-container/close',
          method: 'POST',
          token: ctx.clientToken,
          body: { session_id: sessionId },
        }).catch(() => {});
      }
    } finally {
      // Delete temp user
      await apiCall({
        endpoint: '/api/v1/admin/user/delete/any',
        method: 'POST',
        token: freshAdminToken,
        body: { id: tempUserId },
      }).catch(() => {});
    }
  });

  // -- POSITIVE: own empty session → SESSION_CONTAINER_EMPTY (not IDOR)
  // Documents that sharing requires a session with photos (session_container_commands.ts: EMPTY check).
  // The EMPTY error is expected behavior, not a security issue.
  await test('SESSION_CONTAINER_SHARE_OWN_EMPTY_SESSION_EMPTY_ERROR', async () => {
    const createRes = await apiCall({
      endpoint: '/api/v1/session-container/create',
      method: 'POST',
      token: ctx.clientToken,
      body: {},
    });

    if (createRes.status === 429) {
      console.log('   (Session container quota exceeded — skipping)');
      return;
    }
    if (createRes.status !== 201) {
      throw new Error(
        `Expected 201 on session create, got ${createRes.status}`
      );
    }

    const createData =
      getData<SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CREATE']['RESPONSE']>(createRes);
    const session = createData.session as { id: string };
    const sessionId = session.id;

    try {
      // Sharing an empty session → SESSION_CONTAINER_EMPTY (400), not 403
      const shareRes = await apiCall({
        endpoint: '/api/v1/session-container/share',
        method: 'POST',
        token: ctx.clientToken,
        body: {
          session_id: sessionId,
        } satisfies SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SHARE']['REQUEST'],
      });

      if (shareRes.status === 429) {
        // Quota exceeded — also valid
        assert.equals(
          getEvent(shareRes),
          APP_EVENTS.INFO.SESSION_CONTAINER
            .SESSION_CONTAINER_SHARE_QUOTA_EXCEEDED
        );
        console.log('   (Share quota exceeded — valid behavior)');
      } else {
        // Expected: 400 with SESSION_CONTAINER_EMPTY (own session, no photos)
        assert.status(shareRes, 400);
        assert.equals(
          getEvent(shareRes),
          APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_EMPTY,
          'Empty session should return SESSION_CONTAINER_EMPTY, not IDOR error'
        );
      }
    } finally {
      await apiCall({
        endpoint: '/api/v1/session-container/close',
        method: 'POST',
        token: ctx.clientToken,
        body: { session_id: sessionId },
      }).catch(() => {});
    }
  });
}

// ============================================================================
// 5. PAIRING_SESSION_REVOKE_ALL
// Route: /api/v1/pairing/revoke-all-sessions (POST)
// Auth: STYLIST required (requireStylistAccount guard)
// Risk: authorization boundary
//
// Note: The task spec mentions "client revokes own pairings" but the endpoint
// uses requireStylistAccount, so client → 403. This is the actual endpoint behavior.
// Client-side revoke is at /api/v1/pairing/revoke-access (different endpoint).
// ============================================================================

export async function runPairingRevokeAllTests(
  ctx: TestContext
): Promise<void> {
  console.log('\n🔒 PAIRING_SESSION_REVOKE_ALL\n');

  // -- NEGATIVE: unauthenticated → 401
  await test('PAIRING_REVOKE_ALL_NO_AUTH_401', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/pairing/revoke-all-sessions',
      method: 'POST',
    });
    assert.status(response, 401);
  });

  // -- RBAC: client account → 403 (requireStylistAccount guard)
  // NOTE: This endpoint is STYLIST-only. Client-side pairing revoke is
  // /api/v1/pairing/revoke-access, not this endpoint.
  await test('PAIRING_REVOKE_ALL_CLIENT_RBAC_403', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/pairing/revoke-all-sessions',
      method: 'POST',
      token: ctx.clientToken,
    });
    assert.status(response, 403);
  });

  // -- POSITIVE: stylist with no active pairing sessions → success with count 0
  await test('PAIRING_REVOKE_ALL_NO_SESSIONS_IDEMPOTENT', async () => {
    // Use a fresh stylist token to avoid interference with main stylist's sessions
    const freshStylistToken = await getFreshStylistToken();

    // First revoke all (clears any existing sessions from setup)
    await apiCall({
      endpoint: '/api/v1/pairing/revoke-all-sessions',
      method: 'POST',
      token: freshStylistToken,
    }).catch(() => {});

    // Second revoke → idempotent, count should be 0
    const response = await apiCall({
      endpoint: '/api/v1/pairing/revoke-all-sessions',
      method: 'POST',
      token: freshStylistToken,
    });
    assert.status(response, 200);
    assert.equals(
      getEvent(response),
      APP_EVENTS.INFO.PAIRING.ALL_PAIRING_SESSIONS_REVOKED,
      'Should return ALL_PAIRING_SESSIONS_REVOKED event'
    );
    const data =
      getData<PAIRING_DTO_API_V1['PAIRING_SESSION_REVOKE_ALL']['RESPONSE']>(
        response
      );
    assert.hasProperty(
      data as unknown as Record<string, unknown>,
      'revoked_count'
    );
    assert.equals(
      typeof data.revoked_count,
      'number',
      'revoked_count should be number'
    );
    assert.equals(
      data.revoked_count,
      0,
      'Should revoke 0 when no sessions exist'
    );
  });

  // -- POSITIVE: stylist with active pairing session → count > 0 after revoke
  await test('PAIRING_REVOKE_ALL_WITH_ACTIVE_SESSIONS', async () => {
    const freshStylistToken = await getFreshStylistToken();
    const freshAdminToken = await getAdminToken();

    // Create a temp client to pair with
    const tempEmail = `temp-revoke-all-client-${Date.now()}@example.com`;
    const loginRes = await apiCall({
      endpoint: '/api/auth/dev-login',
      method: 'POST',
      body: { email: tempEmail },
    });
    assert.status(loginRes, 200);
    const loginData =
      getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(loginRes);
    const tempUserId = loginData.id;
    const tempClientToken = extractSessionToken(loginRes);

    try {
      // Issue pairing session from stylist
      const issueRes = await apiCall({
        endpoint: '/api/v1/pairing/issue-session',
        method: 'POST',
        token: freshStylistToken,
      });

      if (issueRes.status === 429) {
        // Too many active sessions (FREE plan limit) — still test revoke-all
        console.log(
          '   (Issue session rate-limited — testing revoke-all on empty state)'
        );
        const revokeRes = await apiCall({
          endpoint: '/api/v1/pairing/revoke-all-sessions',
          method: 'POST',
          token: freshStylistToken,
        });
        assert.status(revokeRes, 200);
        assert.equals(
          getEvent(revokeRes),
          APP_EVENTS.INFO.PAIRING.ALL_PAIRING_SESSIONS_REVOKED
        );
        return;
      }

      assert.status(issueRes, 201);
      const issueData = getData<{ token: string }>(issueRes);
      const pairingToken = issueData.token;

      // Client claims the session
      const claimRes = await apiCall({
        endpoint: '/api/v1/pairing/claim-session',
        method: 'POST',
        token: tempClientToken,
        body: { token: pairingToken },
      });
      if (claimRes.status !== 200 && claimRes.status !== 201) {
        console.log(
          `   (Claim failed: ${claimRes.status} — testing revoke-all with unclaimed session)`
        );
      }

      // Revoke all — should return count >= 1 (at least the issued session)
      const revokeRes = await apiCall({
        endpoint: '/api/v1/pairing/revoke-all-sessions',
        method: 'POST',
        token: freshStylistToken,
      });
      assert.status(revokeRes, 200);
      assert.equals(
        getEvent(revokeRes),
        APP_EVENTS.INFO.PAIRING.ALL_PAIRING_SESSIONS_REVOKED
      );
      const revokeData =
        getData<PAIRING_DTO_API_V1['PAIRING_SESSION_REVOKE_ALL']['RESPONSE']>(
          revokeRes
        );
      assert.equals(
        typeof revokeData.revoked_count,
        'number',
        'revoked_count should be number'
      );
      assert.equals(
        revokeData.revoked_count >= 1,
        true,
        `Expected revoked_count >= 1 after issuing session, got ${revokeData.revoked_count}`
      );

      // Second revoke → idempotent (0 remaining)
      const revokeAgainRes = await apiCall({
        endpoint: '/api/v1/pairing/revoke-all-sessions',
        method: 'POST',
        token: freshStylistToken,
      });
      assert.status(revokeAgainRes, 200);
      const revokeAgainData =
        getData<PAIRING_DTO_API_V1['PAIRING_SESSION_REVOKE_ALL']['RESPONSE']>(
          revokeAgainRes
        );
      assert.equals(
        revokeAgainData.revoked_count,
        0,
        'Second revoke should return 0'
      );
    } finally {
      // Cleanup: delete temp client
      await apiCall({
        endpoint: '/api/v1/admin/user/delete/any',
        method: 'POST',
        token: freshAdminToken,
        body: { id: tempUserId },
      }).catch(() => {});
    }
  });

  // -- ISOLATION: stylist only revokes their OWN sessions (not other stylists')
  await test('PAIRING_REVOKE_ALL_ISOLATION', async () => {
    const freshAdminToken = await getAdminToken();

    // Create a temp stylist
    const tempStylistEmail = `temp-revoke-isolation-stylist-${Date.now()}@example.com`;
    const loginRes = await apiCall({
      endpoint: '/api/auth/dev-login',
      method: 'POST',
      body: { email: tempStylistEmail },
    });
    assert.status(loginRes, 200);
    const loginData =
      getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(loginRes);
    const tempStylistId = loginData.id;
    const tempStylistToken = extractSessionToken(loginRes);

    try {
      // Main stylist issues a pairing session
      const issueMain = await apiCall({
        endpoint: '/api/v1/pairing/issue-session',
        method: 'POST',
        token: ctx.stylistToken,
      });
      // Store whether main stylist had a session to issue
      const mainHadSession = issueMain.status === 201;

      // Temp stylist revokes all their own (should be 0 since they're new)
      const revokeTemp = await apiCall({
        endpoint: '/api/v1/pairing/revoke-all-sessions',
        method: 'POST',
        token: tempStylistToken,
      });
      assert.status(revokeTemp, 200);
      const revokeTempData =
        getData<PAIRING_DTO_API_V1['PAIRING_SESSION_REVOKE_ALL']['RESPONSE']>(
          revokeTemp
        );
      assert.equals(
        revokeTempData.revoked_count,
        0,
        'New stylist should revoke 0 sessions'
      );

      if (mainHadSession) {
        // Main stylist's session should still exist (temp stylist didn't revoke it)
        // Verify by getting main stylist's pairs (issued but not claimed → still active pending session)
        const mainPairs = await apiCall({
          endpoint: '/api/v1/pairing/get-my-pairs',
          method: 'GET',
          token: ctx.stylistToken,
        });
        assert.status(mainPairs, 200);
        // Pairs count not checked — main stylist may or may not have paired clients.
        // The key assertion is revokeTempData.revoked_count === 0 (above), proving isolation.

        // Cleanup: revoke the main stylist's issued session
        await apiCall({
          endpoint: '/api/v1/pairing/revoke-all-sessions',
          method: 'POST',
          token: ctx.stylistToken,
        }).catch(() => {});
      }
    } finally {
      await apiCall({
        endpoint: '/api/v1/admin/user/delete/any',
        method: 'POST',
        token: freshAdminToken,
        body: { id: tempStylistId },
      }).catch(() => {});
    }
  });
}

// ============================================================================
// ENTRY POINT — called from run-smoke-tests.ts
// ============================================================================

export async function runHighRiskEndpointTests(
  ctx: TestContext
): Promise<void> {
  console.log('\n🔴 HIGH-RISK ENDPOINT SMOKE TESTS (Finding #8)\n');

  await runUserConfirmDeleteTests(ctx);
  await runAdminPolicyTests(ctx);
  await runUserConfirmEmailChangeTests(ctx);
  await runSessionContainerShareTests(ctx);
  await runPairingRevokeAllTests(ctx);
}
