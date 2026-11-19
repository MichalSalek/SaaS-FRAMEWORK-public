/**
 * Messaging handlers bound through `defineEndpoint(contract)`.
 *
 * Pins what must not change when the route stops parsing the query by hand:
 *   - a send body without content is 400 and never reaches the operation;
 *   - an empty or repeated pair_id is still passed as '' (not a middleware 400);
 *   - a bad cursor is dropped; only hidden=true selects the hidden list;
 *   - a GET on the send route is 405 with Allow taken from the contract.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import sendHandler from '../../pages/api/v1/messaging/send/index';
import threadHandler from '../../pages/api/v1/messaging/thread/index';
import conversationsHandler from '../../pages/api/v1/messaging/conversations/index';
import { mockApiHandler } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import { makeCurrentUserOutput, makeClientCurrentUser } from '../fixtures';
import {
  PairingStatusValue,
  StylistClientMessageSenderValue,
} from '@kernel/models/db_models.generated.dto';

const ops = vi.hoisted(() => ({
  send: vi.fn(),
  thread: vi.fn(),
  conversations: vi.fn(),
}));

vi.mock('@domain/messaging/operations/messaging-write.operations', () => ({
  sendMessage_IO: ops.send,
  markRead_IO: vi.fn(),
  setConversationHidden_IO: vi.fn(),
}));

vi.mock('@domain/messaging/operations/messaging-query.operations', () => ({
  getThread_IO: ops.thread,
  getConversations_IO: ops.conversations,
}));

vi.mock('@domain/messaging/messaging-notification.service', () => ({
  sendMessagingNotification: vi.fn(),
}));

const CLIENT = makeClientCurrentUser();

const threadOk = {
  success: true as const,
  data: {
    meta: {
      pair_id: '',
      status: PairingStatusValue.PENDING,
      counterpart_name: '',
      counterpart_avatar_url: null,
      viewer_side: StylistClientMessageSenderValue.CLIENT,
      can_send: false,
      hidden_at: null,
    },
    messages: [],
    next_cursor: null,
  },
};

const listOk = {
  success: true as const,
  data: { conversations: [], next_cursor: null },
};

describe('messaging through the API contract', () => {
  beforeEach(() => {
    ops.send.mockReset();
    ops.thread.mockReset();
    ops.conversations.mockReset();
    __setCurrentUser(makeCurrentUserOutput(CLIENT));
    __setPermission(true);
  });

  it('send: a body without content is 400 and never reaches the operation', async () => {
    const { status, event, data } = await mockApiHandler<{
      content?: string;
    }>(sendHandler, {
      method: 'POST',
      body: { pair_id: 'pair_test_000000000000001' },
    });
    expect(status).toBe(400);
    expect(event).toBe('VALIDATION_FAILED');
    expect(data.content).toContain('validation.messaging.contentRequired');
    expect(ops.send).not.toHaveBeenCalled();
  });

  it('send: a GET is 405 with Allow taken from the contract', async () => {
    const result = await mockApiHandler(sendHandler, { method: 'GET' });
    expect(result.status).toBe(405);
    expect(result.data).toEqual({ allowed: 'POST' });
    expect(ops.send).not.toHaveBeenCalled();
  });

  it('thread: an empty or repeated pair_id stays "" and a bad cursor is absent', async () => {
    ops.thread.mockResolvedValue(threadOk);

    await mockApiHandler(threadHandler, {
      method: 'GET',
      query: { pair_id: '', cursor: ['older', 'again'] },
    });
    expect(ops.thread.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ pairId: '' })
    );
    expect(ops.thread.mock.calls[0]?.[0]).not.toHaveProperty('cursor');

    ops.thread.mockClear();
    const { status } = await mockApiHandler(threadHandler, {
      method: 'GET',
      query: { pair_id: ['pair_a', 'pair_b'], cursor: '' },
    });
    expect(status).toBe(200);
    expect(ops.thread.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ pairId: '' })
    );
    expect(ops.thread.mock.calls[0]?.[0]).not.toHaveProperty('cursor');
  });

  it('conversations: only hidden=true filters; a bad hidden and empty cursor do not', async () => {
    ops.conversations.mockResolvedValue(listOk);

    await mockApiHandler(conversationsHandler, {
      method: 'GET',
      query: { hidden: 'false', cursor: '' },
    });
    expect(ops.conversations.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ hidden: false })
    );
    expect(ops.conversations.mock.calls[0]?.[0]).not.toHaveProperty('cursor');

    ops.conversations.mockClear();
    await mockApiHandler(conversationsHandler, {
      method: 'GET',
      query: { hidden: '1', cursor: ['a', 'b'] },
    });
    expect(ops.conversations.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ hidden: false })
    );
    expect(ops.conversations.mock.calls[0]?.[0]).not.toHaveProperty('cursor');

    ops.conversations.mockClear();
    const { status, event } = await mockApiHandler(conversationsHandler, {
      method: 'GET',
      query: { hidden: 'true' },
    });
    expect(status).toBe(200);
    expect(event).toBe('MESSAGING_CONVERSATIONS_FETCHED');
    expect(ops.conversations.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ hidden: true })
    );
  });
});
