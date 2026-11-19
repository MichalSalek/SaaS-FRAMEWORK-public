import { describe, it, expect } from 'vitest';
import {
  resolveSalonAccess_IO,
  ensureSalonPairing_IO,
  canUseSalonPhotoInSession_IO,
} from './salon-access.resolver';
import { owner, setup } from './salon-access.test-fixtures';

describe('salon live access resolver', () => {
  it('keeps direct solo stylist access and performs no salon reads', async () => {
    const db = setup({ direct: true, salons: [] });
    expect(await resolveSalonAccess_IO('client', 'solo')).toEqual({
      kind: 'DIRECT',
      pairId: 'direct',
    });
    expect(db.salonFind).not.toHaveBeenCalled();
  });
  it('opens the whole contributing team through a direct connection', async () => {
    setup();
    expect(await resolveSalonAccess_IO('client', 'colleague')).toEqual({
      kind: 'SALON',
      salonAccountId: 'salon',
      pairId: null,
    });
  });
  it.each(['noncontributing', 'ended membership', 'solo unpaired'])(
    'denies %s when no current owner membership matches',
    async () => {
      const db = setup({ salons: [] });
      expect(await resolveSalonAccess_IO('client', 'colleague')).toBeNull();
      expect(db.salonFind).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({
                staff_members: expect.objectContaining({
                  some: expect.objectContaining({
                    is_active: true,
                    accepted_at: { not: null },
                    public_profile_visible: true,
                  }),
                }),
              }),
            ]),
          }),
        })
      );
    }
  );
  it.each(['FREE', 'PRO', 'PRO_PLUS'])(
    'denies own %s salon plan',
    async pricing_plan => {
      setup({ salons: [{ ...owner, pricing_plan }] });
      expect(await resolveSalonAccess_IO('client', 'colleague')).toBeNull();
    }
  );
  it('denies expired paid salon and ignores derived-only seeds', async () => {
    setup({ salons: [{ ...owner, account_expiration_date: new Date(0) }] });
    expect(await resolveSalonAccess_IO('client', 'colleague')).toBeNull();
    const db = setup({ seeds: [] });
    expect(await resolveSalonAccess_IO('client', 'colleague')).toBeNull();
    expect(db.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ salon_origin_account_id: null }),
      })
    );
  });
  it('respects stylist-initiated disconnect', async () => {
    setup({
      existing: { id: 'revoked', status: 'REVOKED', revoked_by: 'STYLIST' },
    });
    expect(await ensureSalonPairing_IO('client', 'colleague')).toBeNull();
  });
  it('creates a contact lazily and marks its salon origin', async () => {
    const db = setup();
    expect(await ensureSalonPairing_IO('client', 'colleague')).toEqual({
      id: 'derived',
    });
    expect(db.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          salon_origin_account_id: 'salon',
          client_user_id: 'client',
          stylist_account_id: 'colleague',
        }),
      })
    );
  });
  it('does not create a second contact for a real direct pairing', async () => {
    const db = setup({ direct: true });
    expect(await ensureSalonPairing_IO('client', 'solo')).toEqual({
      id: 'direct',
    });
    expect(db.upsert).not.toHaveBeenCalled();
  });
  it('allows another author in the same salon session', async () => {
    setup();
    expect(
      await canUseSalonPhotoInSession_IO('client', 'colleague', 'seed')
    ).toBe(true);
  });
  it('accepts a direct seed belonging to the hundred-and-first Scale contributor', async () => {
    const members = Array.from({ length: 101 }, (_, index) => ({
      user: {
        stylist_account: {
          account_id: `member-${index}`,
          account_status: 'ACTIVE',
        },
      },
    }));
    const db = setup({
      salons: [{ ...owner, pricing_plan: 'SCALE', staff_members: members }],
      seeds: [{ stylist_account_id: 'member-100' }],
    });
    expect(await resolveSalonAccess_IO('client', 'colleague')).toEqual({
      kind: 'SALON',
      salonAccountId: 'salon',
      pairId: null,
    });
    expect(db.salonFind.mock.calls[0]?.[0]).not.toHaveProperty(
      'select.staff_members.take'
    );
    expect(db.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          stylist_account_id: { in: expect.arrayContaining(['member-100']) },
        }),
      })
    );
  });
});
