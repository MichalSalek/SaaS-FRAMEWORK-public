import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { createPairRequest_IO } from './pair-request.operations';
import {
  CLIENT_USER_ID,
  STYLIST_ACCOUNT_ID,
  PAIR_ID,
  mockCreateScenario,
} from './pair-request.test-fixtures';

describe('request from contact', () => {
  it('retries the request when opening a contact won the unique row race', async () => {
    let reads = 0;
    const updateMany = vi.fn(async () => ({ count: 1 }));
    mockDb({
      stylistAccount: {
        findUnique: vi.fn(async () => ({
          display_name: 'Ola',
          created_by_user_id: 'owner',
          account_status: 'ACTIVE',
          created_by_user: {
            email: 'o@example.com',
            name: 'Ola',
            is_active: true,
          },
        })),
      },
      clientStylistPair: {
        findUnique: vi.fn(async () =>
          ++reads === 1
            ? null
            : {
                id: PAIR_ID,
                status: 'CONTACT',
                paired_at: new Date(),
                stylist_account: { display_name: 'Ola' },
              }
        ),
        create: vi.fn(async () => {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }),
        updateMany,
      },
    });
    const result = await createPairRequest_IO({
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });
    expect(result).toMatchObject({
      success: true,
      data: { status: 'PENDING', created: true },
    });
    expect(updateMany).toHaveBeenCalledOnce();
  });
  it('atomically converts CONTACT into a new pending request even when contact is recent', async () => {
    const { create, updateMany } = mockCreateScenario({
      existingPair: { id: PAIR_ID, status: 'CONTACT', paired_at: new Date() },
    });
    const result = await createPairRequest_IO({
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });
    expect(result).toMatchObject({
      success: true,
      data: { status: 'PENDING', created: true, pair_id: PAIR_ID },
    });
    expect(updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: PAIR_ID, status: 'CONTACT' },
      data: { status: 'PENDING' },
    });
    expect(create).not.toHaveBeenCalled();
  });
});
