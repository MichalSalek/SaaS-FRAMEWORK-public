/**
 * Client handlers bound through `defineEndpoint(contract)`.
 *
 * Pins what must not change when the route stops parsing the query by hand:
 *   - a body with an illegal phone is 400 and never reaches the operation;
 *   - client_user_id follows qStr: missing, empty and repeated are
 *     `{ client_user_id: 'Required' }`; a non-empty string is forwarded;
 *   - contact-for-stylist and CRM-note delete are the strict limiter tier;
 *   - a GET on the update route is 405 with Allow from the contract.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import updateContact from '../../pages/api/v1/client/update-contact/index';
import contactForStylist from '../../pages/api/v1/client/contact/get-for-stylist/index';
import { CLIENT_CONTRACTS } from '@kernel/domain/client/client.contracts';
import { mockApiHandler } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import {
  makeCurrentUserOutput,
  makeClientCurrentUser,
  makeStylistCurrentUser,
} from '../fixtures';

const ops = vi.hoisted(() => ({
  update: vi.fn(),
  contact: vi.fn(),
}));

vi.mock('@domain/client/operations/client-profile.operations', () => ({
  updateClientContact_IO: ops.update,
  getClientProfile_IO: vi.fn(),
  getClientContactForStylist_IO: ops.contact,
}));

const CLIENT = makeClientCurrentUser();
const STYLIST = makeStylistCurrentUser();

describe('client through the API contract', () => {
  beforeEach(() => {
    ops.update.mockReset();
    ops.contact.mockReset();
    __setCurrentUser(makeCurrentUserOutput(CLIENT));
    __setPermission(null);
  });

  it('update contact: an illegal phone is 400 and never reaches the operation', async () => {
    const { status, event } = await mockApiHandler(updateContact, {
      method: 'POST',
      body: { contact_phone: 'abc' },
    });
    expect(status).toBe(400);
    expect(event).toBe('VALIDATION_FAILED');
    expect(ops.update).not.toHaveBeenCalled();
  });

  it('update contact: a GET is 405 with Allow taken from the contract', async () => {
    const result = await mockApiHandler(updateContact, { method: 'GET' });
    expect(result.status).toBe(405);
    expect(result.data).toEqual({ allowed: 'POST' });
  });

  it('contact for stylist: missing, empty and repeated ids stay Required; a non-empty string is forwarded', async () => {
    __setCurrentUser(makeCurrentUserOutput(STYLIST));
    ops.contact.mockResolvedValue({
      success: true,
      data: {
        contact_phone: null,
        contact_email: null,
        client_name: 'Anna',
      },
    });

    const rejected: ReadonlyArray<Record<string, string | string[]>> = [
      {},
      { client_user_id: '' },
      { client_user_id: ['a', 'b'] },
    ];
    for (const query of rejected) {
      ops.contact.mockClear();
      const result = await mockApiHandler(contactForStylist, {
        method: 'GET',
        query,
      });
      expect(result.status).toBe(400);
      expect(result.event).toBe('VALIDATION_FAILED');
      expect(result.data).toEqual({ client_user_id: 'Required' });
      expect(ops.contact).not.toHaveBeenCalled();
    }

    const { status } = await mockApiHandler(contactForStylist, {
      method: 'GET',
      query: { client_user_id: 'bad' },
    });
    expect(status).toBe(200);
    expect(ops.contact).toHaveBeenCalledWith(
      expect.objectContaining({
        client_user_id: 'bad',
        stylist_user_id: STYLIST.id,
      })
    );
  });

  it('strict limiter tier is contact-for-stylist and CRM-note delete', () => {
    expect(CLIENT_CONTRACTS.CLIENT_GET_CONTACT_FOR_STYLIST.limiterTier).toBe(
      'strict'
    );
    expect(CLIENT_CONTRACTS.CLIENT_DELETE_CRM_NOTE.limiterTier).toBe('strict');
  });
});
