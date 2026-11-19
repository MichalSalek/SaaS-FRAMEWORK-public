import { describe, expect, it, vi } from 'vitest';
import { __setDb } from '../../../test-utils/setup';
import {
  getClientCrmNote_IO,
  upsertClientCrmNote_IO,
} from './client-crm-note.operations';
import {
  getClientImportantNote_IO,
  upsertClientImportantNote_IO,
} from './client-important-note.operations';
import { getClientContactForStylist_IO } from './client-profile.operations';
import { requireActivePairing_IO } from '@domain/visit/operations/visit-common.operations';
import { getPrivateNotes_IO } from '@domain/private-notes/operations/private-notes-query.operations';

const resolve = vi.hoisted(() => vi.fn(async () => null));
vi.mock('@domain/pairing/salon-access.resolver', () => ({
  resolveSalonAccess_IO: resolve,
}));

describe('expired derived salon access', () => {
  it('denies CRM and important-note reads and writes and contact disclosure', async () => {
    const write = vi.fn(async () => ({ count: 1 }));
    const audit = vi.fn();
    const pair = {
      id: 'pair',
      salon_origin_account_id: 'salon',
      crm_note: 'private',
      crm_note_updated_at: null,
      important_note: 'private',
      important_note_updated_at: null,
    };
    __setDb({
      $queryRaw: vi.fn(async () => [{ id: 'pair' }]),
      clientStylistPair: {
        findFirst: vi.fn(async () => pair),
        findUnique: vi.fn(async () => pair),
        updateMany: write,
      },
      user: {
        findUnique: vi.fn(async () => ({
          stylist_account: { account_id: 'stylist' },
        })),
      },
      clientAccount: {
        findUnique: vi.fn(async () => ({
          contact_phone: 'private',
          contact_email: null,
          created_by_user: { is_active: true, name: 'client' },
        })),
      },
      contactAccessLog: { create: audit },
    });
    const ids = { stylist_account_id: 'stylist', client_user_id: 'client' };
    const results = [
      await getClientCrmNote_IO({ ...ids, stylist_pricing_plan: 'PRO' }),
      await upsertClientCrmNote_IO({
        ...ids,
        stylist_pricing_plan: 'PRO',
        note: 'updated',
      }),
      await getClientImportantNote_IO(ids),
      await upsertClientImportantNote_IO({ ...ids, note: 'updated' }),
      await getClientContactForStylist_IO({
        client_user_id: 'client',
        stylist_user_id: 'stylist-user',
      }),
      await requireActivePairing_IO(ids),
    ];
    expect(results.every(result => !result.success)).toBe(true);
    expect(write).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('filters stale derived notes before using their client IDs to load visits', async () => {
    resolve.mockClear();
    const visits = vi.fn(async () => []);
    const row = {
      salon_origin_account_id: 'salon',
      client_user_id: 'client',
      client_user: { id: 'client', name: 'Client' },
      crm_note: 'private CRM',
      crm_note_updated_at: null,
      important_note: 'private important note',
      important_note_updated_at: null,
    };
    __setDb({
      sessionContainer: { findMany: vi.fn(async () => []) },
      clientStylistPair: { findMany: vi.fn(async () => [row]) },
      visitRecord: { findMany: visits },
    });
    const result = await getPrivateNotes_IO({
      stylist_account_id: 'stylist',
      stylist_pricing_plan: 'PRO',
    });
    expect(result).toMatchObject({
      success: true,
      data: {
        important_notes: [],
        client_notes: [],
        visit_notes: [],
        clients: [],
      },
    });
    expect(visits).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledOnce();
  });
});
