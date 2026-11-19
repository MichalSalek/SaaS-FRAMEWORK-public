/**
 * Support handlers bound through `defineEndpoint(contract)`.
 *
 * Pins what must not change when the route stops parsing the query by hand:
 *   - a missing thread id is still 400 `{ thread_id: 'Required' }` (not the unused i18n schema);
 *   - list filters fall back (take) or drop an unknown value (status);
 *   - admin operations are refused for a client at RBAC;
 *   - a create without a category never reaches the operation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import createThread from '../../pages/api/v1/support/create-thread/index';
import myThreads from '../../pages/api/v1/support/my-threads/index';
import threadMessages from '../../pages/api/v1/support/thread-messages/index';
import adminThreads from '../../pages/api/v1/admin/support/threads/index';
import { mockApiHandler } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import {
  makeCurrentUserOutput,
  makeClientCurrentUser,
  makeStylistCurrentUser,
} from '../fixtures';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';

const ops = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  messages: vi.fn(),
  adminList: vi.fn(),
}));

vi.mock('@domain/support/operations/support-thread.operations', () => ({
  createSupportThread_IO: ops.create,
  addSupportMessage_IO: vi.fn(),
}));

vi.mock('@domain/support/operations/support-thread-queries.operations', () => ({
  getSupportThreads_IO: ops.list,
  getSupportThreadMessages_IO: ops.messages,
}));

vi.mock('@domain/support/operations/support-admin.operations', () => ({
  adminGetAllThreads_IO: ops.adminList,
  adminReplyToThread_IO: vi.fn(),
  adminChangeThreadStatus_IO: vi.fn(),
  adminGetThreadMessages_IO: vi.fn(),
}));

vi.mock('@domain/support/support-email.service', () => ({
  sendSupportNewThreadAdminAlert: vi.fn(),
  sendSupportNewMessageAdminAlert: vi.fn(),
  sendSupportReplyNotification: vi.fn(),
}));

const CLIENT = makeClientCurrentUser();
const ADMIN = makeStylistCurrentUser({
  user: { role_id: SystemRoleId.MASTER_ADMIN },
});

describe('support through the API contract', () => {
  beforeEach(() => {
    ops.create.mockReset();
    ops.list.mockReset();
    ops.messages.mockReset();
    ops.adminList.mockReset();
    __setCurrentUser(makeCurrentUserOutput(CLIENT));
    __setPermission(null);
  });

  it('create: a body without a category is 400 and never reaches the operation', async () => {
    const { status, event } = await mockApiHandler(createThread, {
      method: 'POST',
      body: { message: 'Potrzebuję pomocy z galerią, zdjęcia znikają.' },
    });
    expect(status).toBe(400);
    expect(event).toBe('VALIDATION_FAILED');
    expect(ops.create).not.toHaveBeenCalled();
  });

  it('create: a GET is 405 with Allow taken from the contract', async () => {
    const result = await mockApiHandler(createThread, { method: 'GET' });
    expect(result.status).toBe(405);
    expect(result.data).toEqual({ allowed: 'POST' });
  });

  it('my-threads: a bad take falls back to 20 and an empty cursor is absent', async () => {
    ops.list.mockResolvedValue({
      success: true,
      data: { threads: [], nextCursor: null },
    });
    const { status, event } = await mockApiHandler(myThreads, {
      method: 'GET',
      query: { take: 'nope', cursor: '' },
    });
    expect(status).toBe(200);
    expect(event).toBe('SUPPORT_THREADS_FETCHED');
    expect(ops.list).toHaveBeenCalledWith(CLIENT.id, {
      cursor: undefined,
      take: 20,
    });
  });

  it('thread messages: a missing thread id stays the literal Required 400', async () => {
    const { status, event, data } = await mockApiHandler(threadMessages, {
      method: 'GET',
      query: {},
    });
    expect(status).toBe(400);
    expect(event).toBe('VALIDATION_FAILED');
    expect(data).toEqual({ thread_id: 'Required' });
    expect(ops.messages).not.toHaveBeenCalled();
  });

  it('admin list: a client is refused by RBAC (403) before the operation', async () => {
    const { status } = await mockApiHandler(adminThreads, { method: 'GET' });
    expect(status).toBe(403);
    expect(ops.adminList).not.toHaveBeenCalled();
  });

  it('admin list: an unknown status is dropped and only awaiting_reply=true filters', async () => {
    __setCurrentUser(makeCurrentUserOutput(ADMIN));
    ops.adminList.mockResolvedValue({
      success: true,
      data: { threads: [], nextCursor: null },
    });
    const { status } = await mockApiHandler(adminThreads, {
      method: 'GET',
      query: { status: 'MAYBE', awaiting_reply: 'false', take: '10' },
    });
    expect(status).toBe(200);
    expect(ops.adminList).toHaveBeenCalledWith(
      ADMIN,
      { status: undefined, category: undefined, awaitingReply: false },
      { cursor: undefined, take: 10 }
    );
  });
});
