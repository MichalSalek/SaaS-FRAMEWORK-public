import { describe, it, expect, vi } from 'vitest';
import { makeClientCurrentUser } from '../../test-utils/fixtures';
const CLIENT_USER = makeClientCurrentUser();
const ensure = vi.fn();
const send = vi.fn();
vi.mock('./salon-access.resolver', () => ({
  ensureSalonPairing_IO: (...args: unknown[]) => ensure(...args),
}));
vi.mock('@domain/messaging/operations/messaging-write.operations', () => ({
  sendMessage_IO: (...args: unknown[]) => send(...args),
}));
import { contactSalonStylist_IO } from './salon-contact.operations';
import { mockDb } from '../../test-utils/mockApiHandler';
describe('salon first contact message', () => {
  it('creates and sends in the same transaction using the existing notification result', async () => {
    mockDb({});
    ensure.mockResolvedValue({ id: 'pair' });
    send.mockResolvedValue({
      success: true,
      data: {
        message: { id: 'message' },
        notifyRecipientUserId: 'stylist-user',
        senderSide: 'CLIENT',
        pairStatus: 'ACTIVE',
      },
    });
    const result = await contactSalonStylist_IO(
      CLIENT_USER,
      'stylist',
      'Dzień dobry'
    );
    expect(result.success).toBe(true);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        pairId: 'pair',
        content: 'Dzień dobry',
        currentUser: CLIENT_USER,
        tx: expect.anything(),
      })
    );
  });
  it('returns the original quota failure through transaction rollback', async () => {
    mockDb({});
    ensure.mockResolvedValue({ id: 'pair' });
    send.mockResolvedValue({
      success: false,
      error: { type: 'MESSAGING_RATE_LIMITED', retryAfterSeconds: 60 },
    });
    expect(
      await contactSalonStylist_IO(CLIENT_USER, 'stylist', 'Dzień dobry')
    ).toEqual({
      success: false,
      error: { type: 'MESSAGING_RATE_LIMITED', retryAfterSeconds: 60 },
    });
  });
  it('does not send when salon access is gone', async () => {
    mockDb({});
    ensure.mockResolvedValue(null);
    send.mockClear();
    expect(
      await contactSalonStylist_IO(CLIENT_USER, 'stylist', 'Dzień dobry')
    ).toEqual({ success: false, error: { type: 'MESSAGING_PAIR_NOT_FOUND' } });
    expect(send).not.toHaveBeenCalled();
  });
});
