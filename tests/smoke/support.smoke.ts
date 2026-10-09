/**
 * Support Messaging domain smoke tests
 *
 * Covers: full user + admin flow, authorization, error cases.
 * These tests would have caught:
 *   - GET/POST mismatch (405)
 *   - subject=thread_id bug
 *   - Admin unable to read thread messages
 */

import {
  test,
  apiCall,
  getData,
  getEvent,
  assert,
  extractSessionToken,
} from './_test-utils';
import type { TestContext } from './_test-utils';
import type { SUPPORT_DTO_API_V1 } from '@kernel/models/support/support.dto';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';

export async function runSupportTests(ctx: TestContext): Promise<void> {
  let threadId = '';

  // FRESH THREAD OWNER PER RUN — deliberate, and the reason is measured, not
  // theoretical. Creating a support thread is capped at
  // SUPPORT_THREAD_RATE_LIMIT = 5 per ROLLING HOUR per user
  // (web-1 support-thread.operations.ts), and threads are never deleted. Owning
  // every thread with the SHARED test stylist meant the 6th smoke run inside an
  // hour got 429 on SUPPORT_CREATE_THREAD, leaving `threadId` empty — and then
  // NINE downstream tests failed with `thread_id: Required` 400s that say
  // nothing about support and everything about how often the suite ran.
  // A brand-new identity starts the hour at zero threads, so this suite is
  // re-runnable. Same pattern (and same rationale) as the shares-per-hour quota
  // in quota-limits.smoke.ts C4. The OTHER two identities are unchanged on
  // purpose: ctx.clientToken stays the foreign user for the anti-enumeration
  // check, ctx.adminToken stays the admin.
  const ownerLogin = await apiCall({
    endpoint: '/api/auth/dev-login',
    method: 'POST',
    body: { email: `temp-support-owner-${Date.now()}@example.com` },
  });
  assert.status(ownerLogin, 200);
  const ownerToken = extractSessionToken(ownerLogin);
  // Parity with the previous owner identity (a stylist), so any role-sensitive
  // behaviour this suite might grow keeps the shape it was written against.
  await apiCall({
    endpoint: '/api/v1/user/switch-role',
    method: 'POST',
    token: ownerToken,
    body: { account_type: AccountTypeValue.STYLIST },
  });

  await test('SUPPORT_CREATE_THREAD', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/support/create-thread',
      method: 'POST',
      token: ownerToken,
      // S126: a category instead of a subject. The server derives the title
      // from the first line of the message, asserted below.
      body: {
        category: 'QUESTION',
        message: 'Smoke test thread\nThis is a smoke test message for support.',
      },
    });
    assert.status(response, 201);

    const data =
      getData<SUPPORT_DTO_API_V1['SUPPORT_CREATE_THREAD']['RESPONSE']>(response);
    assert.hasProperty(data, 'thread_id');
    assert.equals(
      typeof data.thread_id,
      'string',
      'thread_id should be string'
    );
    assert.equals(data.thread_id.length > 10, true, 'thread_id should be CUID');
    threadId = data.thread_id;
  });

  await test('SUPPORT_GET_MY_THREADS', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/support/my-threads',
      method: 'GET',
      token: ownerToken,
    });
    assert.status(response, 200);

    const data =
      getData<SUPPORT_DTO_API_V1['SUPPORT_GET_MY_THREADS']['RESPONSE']>(response);
    assert.hasProperty(data, 'threads');
    assert.equals(Array.isArray(data.threads), true, 'threads should be array');

    const found = data.threads.find(t => t.id === threadId);
    assert.equals(!!found, true, 'created thread should appear in list');
    if (found) {
      assert.equals(found.subject, 'Smoke test thread');
      assert.equals(found.category, 'QUESTION');
      assert.equals(
        found.has_unread_reply,
        false,
        'a fresh thread has nothing unread'
      );
      assert.equals(found.status, 'OPEN');
      assert.equals(
        found.message_count >= 1,
        true,
        'should have at least 1 message'
      );
    }
  });

  await test('SUPPORT_ADD_MESSAGE', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/support/add-message',
      method: 'POST',
      token: ownerToken,
      body: {
        thread_id: threadId,
        content: 'Follow-up message from smoke test.',
      },
    });
    assert.status(response, 201);

    const data =
      getData<SUPPORT_DTO_API_V1['SUPPORT_ADD_MESSAGE']['RESPONSE']>(response);
    assert.hasProperty(data, 'message_id');
    assert.equals(
      typeof data.message_id,
      'string',
      'message_id should be string'
    );
  });

  await test('SUPPORT_GET_THREAD_MESSAGES', async () => {
    const response = await apiCall({
      endpoint: `/api/v1/support/thread-messages?thread_id=${threadId}`,
      method: 'GET',
      token: ownerToken,
    });
    assert.status(response, 200);

    const data =
      getData<SUPPORT_DTO_API_V1['SUPPORT_GET_THREAD_MESSAGES']['RESPONSE']>(response);
    assert.hasProperty(data, 'messages');
    assert.hasProperty(data, 'thread');
    assert.equals(data.messages.length >= 2, true, 'should have 2+ messages');
    assert.equals(data.thread.id, threadId);
    assert.equals(data.thread.subject, 'Smoke test thread');
    assert.equals(data.thread.status, 'OPEN');

    assert.equals(data.messages[0].sender_type, 'USER');
    assert.equals(typeof data.messages[0].content, 'string');
  });

  await test('SUPPORT_THREAD_NOT_AUTHORIZED', async () => {
    // Anti-enumeration (SSOT: error-mapper.ts + MEMORY_AI/testy-api.md 2026-05-30):
    // a thread that EXISTS but belongs to another user MUST be byte-for-byte
    // indistinguishable from a non-existent one — otherwise the 403-vs-404 split
    // leaks which thread ids are real (IDOR enumeration). The operation still
    // returns SUPPORT_THREAD_NOT_AUTHORIZED internally, but error-mapper folds it
    // into the unified 404 + SUPPORT_THREAD_NOT_FOUND on purpose (DECISION comment
    // there forbids splitting it back to 403). This test asserts that masked
    // response; do NOT "fix" it back to 403.
    const response = await apiCall({
      endpoint: `/api/v1/support/thread-messages?thread_id=${threadId}`,
      method: 'GET',
      token: ctx.clientToken,
    });
    assert.status(response, 404);
    const event = getEvent(response);
    assert.equals(event, 'SUPPORT_THREAD_NOT_FOUND');
  });

  await test('SUPPORT_ADMIN_GET_ALL_THREADS', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/support/threads',
      method: 'GET',
      token: ctx.adminToken,
    });
    assert.status(response, 200);

    const data =
      getData<SUPPORT_DTO_API_V1['SUPPORT_ADMIN_GET_ALL_THREADS']['RESPONSE']>(
        response
      );
    assert.hasProperty(data, 'threads');
    assert.equals(Array.isArray(data.threads), true);

    const found = data.threads.find(t => t.id === threadId);
    assert.equals(!!found, true, 'admin should see created thread');
    if (found) {
      assert.hasProperty(
        found as unknown as Record<string, unknown>,
        'user_email'
      );
      assert.hasProperty(
        found as unknown as Record<string, unknown>,
        'message_count'
      );
    }
  });

  await test('SUPPORT_ADMIN_GET_THREAD_MESSAGES', async () => {
    const response = await apiCall({
      endpoint: `/api/v1/admin/support/thread-messages?thread_id=${threadId}`,
      method: 'GET',
      token: ctx.adminToken,
    });
    assert.status(response, 200);

    const data =
      getData<SUPPORT_DTO_API_V1['SUPPORT_GET_THREAD_MESSAGES']['RESPONSE']>(response);
    assert.equals(
      data.messages.length >= 2,
      true,
      'admin should see all messages'
    );
    assert.equals(data.thread.subject, 'Smoke test thread');
  });

  await test('SUPPORT_ADMIN_REPLY', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/support/reply',
      method: 'POST',
      token: ctx.adminToken,
      body: {
        thread_id: threadId,
        content: 'Admin reply from smoke test.',
      },
    });
    assert.status(response, 201);

    const data =
      getData<SUPPORT_DTO_API_V1['SUPPORT_ADMIN_REPLY']['RESPONSE']>(response);
    assert.hasProperty(data, 'message_id');
  });

  await test('SUPPORT_ADMIN_AWAITING_REPLY_FILTER', async () => {
    // The admin has just replied, so the thread no longer waits for support:
    // the list behind the menu badge must not contain it.
    const response = await apiCall({
      endpoint: '/api/v1/admin/support/threads?awaiting_reply=true&take=100',
      method: 'GET',
      token: ctx.adminToken,
    });
    assert.status(response, 200);
    const data =
      getData<SUPPORT_DTO_API_V1['SUPPORT_ADMIN_GET_ALL_THREADS']['RESPONSE']>(
        response
      );
    assert.equals(
      data.threads.some(t => t.id === threadId),
      false,
      'an answered thread is not awaiting a reply'
    );
  });

  await test('SUPPORT_GET_UNREAD_COUNT + SUPPORT_MARK_THREAD_READ', async () => {
    const before = await apiCall({
      endpoint: '/api/v1/support/unread-count',
      method: 'GET',
      token: ownerToken,
    });
    assert.status(before, 200);
    const beforeData =
      getData<SUPPORT_DTO_API_V1['SUPPORT_GET_UNREAD_COUNT']['RESPONSE']>(
        before
      );
    assert.equals(
      beforeData.unread_threads >= 1,
      true,
      'the admin reply is unread'
    );

    // A foreign user gets the same 404 as for a missing thread.
    const foreign = await apiCall({
      endpoint: '/api/v1/support/mark-thread-read',
      method: 'POST',
      token: ctx.adminToken,
      body: { thread_id: threadId },
    });
    assert.status(foreign, 404);

    const marked = await apiCall({
      endpoint: '/api/v1/support/mark-thread-read',
      method: 'POST',
      token: ownerToken,
      body: { thread_id: threadId },
    });
    assert.status(marked, 200);

    const after = await apiCall({
      endpoint: '/api/v1/support/unread-count',
      method: 'GET',
      token: ownerToken,
    });
    const afterData =
      getData<SUPPORT_DTO_API_V1['SUPPORT_GET_UNREAD_COUNT']['RESPONSE']>(after);
    assert.equals(
      afterData.unread_threads,
      beforeData.unread_threads - 1,
      'marking the thread read lowers the badge by one'
    );
  });

  await test('SUPPORT_ADMIN_CHANGE_STATUS', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/support/change-status',
      method: 'POST',
      token: ctx.adminToken,
      body: {
        thread_id: threadId,
        status: 'RESOLVED',
      },
    });
    assert.status(response, 200);

    const data =
      getData<SUPPORT_DTO_API_V1['SUPPORT_CHANGE_STATUS']['RESPONSE']>(response);
    assert.equals(data.status, 'RESOLVED');

    // Verify status actually changed
    const verifyResponse = await apiCall({
      endpoint: `/api/v1/support/thread-messages?thread_id=${threadId}`,
      method: 'GET',
      token: ownerToken,
    });
    const verifyData =
      getData<SUPPORT_DTO_API_V1['SUPPORT_GET_THREAD_MESSAGES']['RESPONSE']>(
        verifyResponse
      );
    assert.equals(verifyData.thread.status, 'RESOLVED');
  });

  await test('SUPPORT_USER_REOPENS_RESOLVED_THREAD', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/support/add-message',
      method: 'POST',
      token: ownerToken,
      body: {
        thread_id: threadId,
        content: 'Reopening resolved thread.',
      },
    });
    assert.status(response, 201);

    // Thread should reopen
    const verifyResponse = await apiCall({
      endpoint: `/api/v1/support/thread-messages?thread_id=${threadId}`,
      method: 'GET',
      token: ownerToken,
    });
    const verifyData =
      getData<SUPPORT_DTO_API_V1['SUPPORT_GET_THREAD_MESSAGES']['RESPONSE']>(
        verifyResponse
      );
    assert.equals(
      verifyData.thread.status,
      'OPEN',
      'user message should reopen RESOLVED thread'
    );
  });

  await test('SUPPORT_THREAD_NOT_FOUND', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/support/thread-messages?thread_id=nonexistent_thread_id_12345',
      method: 'GET',
      token: ownerToken,
    });
    assert.status(response, 404);
  });
}
