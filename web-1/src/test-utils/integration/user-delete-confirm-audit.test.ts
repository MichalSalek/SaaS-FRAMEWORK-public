/**
 * user/delete/confirm writes USER_DELETE_CONFIRMED only for an applied deletion.
 *
 * The link in the deletion e-mail can be opened again (mail client prefetch, a
 * second tap, a forwarded mail). Those replays stay an idempotent 200
 * `{ confirmed: true }` for the client, but the audit row must appear once per
 * logical deletion, not once per click. The operation is mocked here: its own
 * replay branches are covered in user-delete-confirm.operations.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

const spies = vi.hoisted(() => ({
  confirmDeleteSelf_IO: vi.fn(),
  recordAuditEvent_IO: vi.fn(async () => undefined),
}));

vi.mock('@domain/user/operations/user-mutations.operations', () => ({
  confirmDeleteSelf_IO: spies.confirmDeleteSelf_IO,
}));
vi.mock('@app/event-log/event-log-io.wrapper', () => ({
  recordAuditEvent_IO: spies.recordAuditEvent_IO,
}));
// Run the deferred audit inline so the assertion does not race a floating promise.
vi.mock('@app/runtime/run-after-response', () => ({
  runAfterResponse: (task: () => Promise<unknown>) => {
    void task();
  },
}));

import deleteConfirmHandler from '../../pages/api/v1/user/delete/confirm/index';
import { mockApiHandler } from '../mockApiHandler';
import { __setPermission } from '../setup';

const USER_ID = 'usr_test_0000000000000001';
const TOKEN = 'a'.repeat(40);

const callConfirm = () =>
  mockApiHandler<{ confirmed: boolean }>(deleteConfirmHandler, {
    method: 'GET',
    query: { token: TOKEN },
  });

beforeEach(() => {
  __setPermission(true);
  spies.confirmDeleteSelf_IO.mockReset();
  spies.recordAuditEvent_IO.mockClear();
});

describe('user/delete/confirm — audit only on applied deletion', () => {
  it('applied deletion → 200 { confirmed } + one USER_DELETE_CONFIRMED row', async () => {
    spies.confirmDeleteSelf_IO.mockResolvedValue({
      success: true,
      data: { confirmed: true, userId: USER_ID, applied: true },
    });

    const { status, event, data } = await callConfirm();

    expect(status).toBe(200);
    expect(data).toEqual({ confirmed: true });
    expect(event).toBe(APP_EVENTS.INFO.USER.USER_DELETE_CONFIRMED);
    expect(spies.recordAuditEvent_IO).toHaveBeenCalledTimes(1);
    expect(spies.recordAuditEvent_IO).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: APP_EVENTS.INFO.USER.USER_DELETE_CONFIRMED,
        user: { id: USER_ID },
      })
    );
  });

  it('replay (no-op) → same 200 { confirmed } and NO audit row', async () => {
    spies.confirmDeleteSelf_IO.mockResolvedValue({
      success: true,
      data: { confirmed: true, userId: USER_ID, applied: false },
    });

    const { status, event, data } = await callConfirm();

    expect(status).toBe(200);
    expect(data).toEqual({ confirmed: true });
    expect(event).toBe(APP_EVENTS.INFO.USER.USER_DELETE_CONFIRMED);
    expect(spies.recordAuditEvent_IO).not.toHaveBeenCalled();
  });
});
