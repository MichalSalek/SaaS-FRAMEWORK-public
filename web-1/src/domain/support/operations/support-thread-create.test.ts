/**
 * createSupportThread_IO (S126): the request carries a category and one
 * message; the thread title is derived by the server and handed back for the
 * admin alert mail.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';

vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

import { createSupportThread_IO } from './support-thread.operations';

const USER_ID = 'usr_test_0000000000000001';

describe('createSupportThread_IO', () => {
  it('stores the category and a title derived from the first line of the message', async () => {
    const create = vi.fn(async (_args: unknown) => ({ id: 'thr_new' }));
    mockDb({ supportThread: { count: async () => 0, create } });

    const result = await createSupportThread_IO({
      userId: USER_ID,
      category: 'BILLING',
      firstMessage: '  Płatność   nie przeszła\nKarta została odrzucona.',
    });

    expect(result).toEqual({
      success: true,
      data: { thread_id: 'thr_new', subject: 'Płatność nie przeszła' },
    });
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        user_id: USER_ID,
        subject: 'Płatność nie przeszła',
        category: 'BILLING',
        messages: {
          create: {
            sender_type: 'USER',
            // The message itself is stored as written.
            content: '  Płatność   nie przeszła\nKarta została odrzucona.',
          },
        },
      },
    });
    // The read marker is left to its column default (now): a new thread
    // starts as read.
    const data = (create.mock.calls[0]?.[0] as { data: object }).data;
    expect(data).not.toHaveProperty('user_last_read_at');
  });

  it('the hourly limit still refuses before anything is written', async () => {
    const create = vi.fn();
    mockDb({ supportThread: { count: async () => 5, create } });

    const result = await createSupportThread_IO({
      userId: USER_ID,
      category: 'QUESTION',
      firstMessage: 'Dzień dobry, mam pytanie o plan.',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SUPPORT_RATE_LIMITED');
    }
    expect(create).not.toHaveBeenCalled();
  });
});
