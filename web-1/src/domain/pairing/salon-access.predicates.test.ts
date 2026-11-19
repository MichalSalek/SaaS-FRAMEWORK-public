import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../test-utils/mockApiHandler';
import {
  resolveSalonAccess_IO,
  ensureSalonPairing_IO,
  canUseSalonPhotoInSession_IO,
} from './salon-access.resolver';
import { owner, setup } from './salon-access.test-fixtures';

// The three Prisma predicates are the access policy, so they are pinned exactly.
// A removed or loosened filter (status, active client, visible stylist, contributing
// membership) must fail here, not only in a live-database suite.
const VISIBLE = {
  account_status: 'ACTIVE',
  created_by_user: { is_active: true },
};
const CONTRIBUTING = {
  is_active: true,
  accepted_at: { not: null },
  public_profile_visible: true,
};

describe('salon access predicates (exact where clauses)', () => {
  it('direct branch: ACTIVE, not salon-derived, visible stylist, active client', async () => {
    const db = setup({ direct: true });
    await resolveSalonAccess_IO('client', 'solo');
    expect(db.findFirst).toHaveBeenCalledWith({
      where: {
        client_user_id: 'client',
        stylist_account_id: 'solo',
        status: 'ACTIVE',
        salon_origin_account_id: null,
        stylist_account: VISIBLE,
        client_user: { is_active: true },
      },
      select: { id: true },
    });
  });

  it('salon lookup: visible, non-banned owner that IS the stylist or has her as a contributing, active member', async () => {
    const db = setup();
    await resolveSalonAccess_IO('client', 'colleague');
    const args = db.salonFind.mock.calls[0]?.[0] as {
      where: unknown;
      select: { staff_members: { where: unknown } };
      take: number;
    };
    expect(args.where).toEqual({
      ...VISIBLE,
      created_by_user: { is_active: true, disabled_at: null },
      OR: [
        { account_id: 'colleague' },
        {
          staff_members: {
            some: {
              ...CONTRIBUTING,
              user: {
                is_active: true,
                disabled_at: null,
                stylist_account: { account_id: 'colleague', ...VISIBLE },
              },
            },
          },
        },
      ],
    });
    expect(args.select.staff_members.where).toEqual({
      ...CONTRIBUTING,
      user: { is_active: true, disabled_at: null },
    });
    expect(args.take).toBe(10);
  });

  it('seed lookup: only ACTIVE direct pairs of an active client with a visible contributor', async () => {
    const db = setup();
    await resolveSalonAccess_IO('client', 'colleague');
    expect(db.findMany).toHaveBeenCalledWith({
      where: {
        client_user_id: 'client',
        status: 'ACTIVE',
        salon_origin_account_id: null,
        stylist_account_id: { in: ['salon', 'seed', 'colleague'] },
        client_user: { is_active: true },
        stylist_account: VISIBLE,
      },
      select: { stylist_account_id: true },
      take: 100,
    });
  });

  it('a member whose own account is not ACTIVE is no seed for the salon', async () => {
    const db = setup({
      salons: [
        {
          ...owner,
          staff_members: [
            {
              user: {
                stylist_account: {
                  account_id: 'seed',
                  account_status: 'EXPIRED',
                },
              },
            },
          ],
        },
      ],
    });
    // The mock returns the seed regardless; the resolver must not count it as a contributor.
    expect(await resolveSalonAccess_IO('client', 'colleague')).toBeNull();
    expect(db.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          stylist_account_id: { in: ['salon'] },
        }),
      })
    );
  });

  it('a member user without a stylist account is skipped, not dereferenced', async () => {
    setup({
      salons: [
        {
          ...owner,
          staff_members: [
            { user: { stylist_account: null } },
            ...owner.staff_members,
          ] as unknown as typeof owner.staff_members,
        },
      ],
    });
    expect(await resolveSalonAccess_IO('client', 'colleague')).toEqual({
      kind: 'SALON',
      salonAccountId: 'salon',
      pairId: null,
    });
  });

  it('no eligible salon: no seed query at all', async () => {
    const db = setup({ salons: [{ ...owner, pricing_plan: 'FREE' }] });
    expect(await resolveSalonAccess_IO('client', 'colleague')).toBeNull();
    expect(db.findMany).not.toHaveBeenCalled();
  });

  it('existing pair is read by the client+stylist key; an ACTIVE one is reused as the pairId', async () => {
    const findUnique = vi.fn(async (_args: unknown) => ({
      id: 'pair-active',
      status: 'ACTIVE',
      revoked_by: null,
    }));
    mockDb({
      clientStylistPair: {
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => [{ stylist_account_id: 'seed' }]),
        findUnique,
      },
      stylistAccount: { findMany: vi.fn(async () => [owner]) },
    });
    expect(await resolveSalonAccess_IO('client', 'colleague')).toEqual({
      kind: 'SALON',
      salonAccountId: 'salon',
      pairId: 'pair-active',
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        client_user_id_stylist_account_id: {
          client_user_id: 'client',
          stylist_account_id: 'colleague',
        },
      },
      select: { id: true, status: true, revoked_by: true },
    });
  });

  it('only a STYLIST disconnect is authoritative: a pair the client revoked keeps salon access', async () => {
    setup({
      existing: { id: 'revoked', status: 'REVOKED', revoked_by: 'CLIENT' },
    });
    expect(await resolveSalonAccess_IO('client', 'colleague')).toEqual({
      kind: 'SALON',
      salonAccountId: 'salon',
      pairId: null,
    });
  });

  it('salonOnly skips a direct pair and answers from the salon branch', async () => {
    const db = setup({ direct: true });
    expect(
      await resolveSalonAccess_IO('client', 'colleague', undefined, true)
    ).toEqual({ kind: 'SALON', salonAccountId: 'salon', pairId: null });
    expect(db.salonFind).toHaveBeenCalled();
  });
});

describe('ensureSalonPairing_IO: the derived contact it writes', () => {
  it('upserts an ACTIVE salon-derived pair and clears a previous revoke', async () => {
    const db = setup({
      existing: { id: 'old', status: 'REVOKED', revoked_by: 'CLIENT' },
    });
    expect(await ensureSalonPairing_IO('client', 'colleague')).toEqual({
      id: 'derived',
    });
    expect(db.upsert).toHaveBeenCalledWith({
      where: {
        client_user_id_stylist_account_id: {
          client_user_id: 'client',
          stylist_account_id: 'colleague',
        },
      },
      create: {
        client_user_id: 'client',
        stylist_account_id: 'colleague',
        salon_origin_account_id: 'salon',
        status: 'ACTIVE',
      },
      update: {
        status: 'ACTIVE',
        salon_origin_account_id: 'salon',
        revoked_at: null,
        revoked_by: null,
      },
      select: { id: true },
    });
  });

  it('no access: nothing is written', async () => {
    const db = setup({ salons: [] });
    expect(await ensureSalonPairing_IO('client', 'colleague')).toBeNull();
    expect(db.upsert).not.toHaveBeenCalled();
  });
});

describe('canUseSalonPhotoInSession_IO', () => {
  const pairDb = (
    salonsByStylist: Record<string, (typeof owner)[]>,
    directFor: string[] = []
  ) => {
    const findFirst = vi.fn(
      async (args: { where: { stylist_account_id: string } }) =>
        directFor.includes(args.where.stylist_account_id)
          ? { id: `direct-${args.where.stylist_account_id}` }
          : null
    );
    mockDb({
      clientStylistPair: {
        findFirst,
        findMany: vi.fn(async () => [{ stylist_account_id: 'seed' }]),
        findUnique: vi.fn(async () => null),
      },
      stylistAccount: {
        findMany: vi.fn(
          async (args: { where: { OR: [{ account_id: string }] } }) =>
            salonsByStylist[args.where.OR[0].account_id] ?? []
        ),
      },
    });
    return { findFirst };
  };

  it('same stylist: plain access, a direct pair is enough', async () => {
    const db = pairDb({}, ['solo']);
    expect(await canUseSalonPhotoInSession_IO('client', 'solo', 'solo')).toBe(
      true
    );
    expect(db.findFirst).toHaveBeenCalled();
  });

  it('same stylist without any access: refused', async () => {
    pairDb({});
    expect(await canUseSalonPhotoInSession_IO('client', 'solo', 'solo')).toBe(
      false
    );
  });

  it('two stylists with direct pairs but no salon in common: refused (direct pairs never bridge)', async () => {
    const db = pairDb({}, ['receiver', 'author']);
    expect(
      await canUseSalonPhotoInSession_IO('client', 'receiver', 'author')
    ).toBe(false);
    // salonOnly: the direct branch result is never used for a cross-author check.
    expect(db.findFirst).toHaveBeenCalledTimes(2);
  });

  it('receiver and author in DIFFERENT salons: refused', async () => {
    pairDb({
      receiver: [{ ...owner, account_id: 'salon-a' }],
      author: [{ ...owner, account_id: 'salon-b' }],
    });
    expect(
      await canUseSalonPhotoInSession_IO('client', 'receiver', 'author')
    ).toBe(false);
  });

  it('only the author is in a salon: refused', async () => {
    pairDb({ author: [owner] });
    expect(
      await canUseSalonPhotoInSession_IO('client', 'receiver', 'author')
    ).toBe(false);
  });

  it('only the receiver is in a salon: refused', async () => {
    pairDb({ receiver: [owner] });
    expect(
      await canUseSalonPhotoInSession_IO('client', 'receiver', 'author')
    ).toBe(false);
  });

  it('both in the same salon AND both directly paired: allowed through the salon branch, not the direct one', async () => {
    pairDb({ receiver: [owner], author: [owner] }, ['receiver', 'author']);
    expect(
      await canUseSalonPhotoInSession_IO('client', 'receiver', 'author')
    ).toBe(true);
  });

  it('both in the same salon: allowed', async () => {
    pairDb({ receiver: [owner], author: [owner] });
    expect(
      await canUseSalonPhotoInSession_IO('client', 'receiver', 'author')
    ).toBe(true);
  });
});
