/**
 * Retired profile links (owner, SCHEMA_DECISIONS.md#profile-link-alias).
 *
 * The contract the types do not hold:
 *  - changing her link reserves the old one for HER account, in the same transaction;
 *  - taking back an earlier link of her own deletes that alias;
 *  - another stylist's retired link is „taken” for everyone else;
 *  - a chain A→B→C resolves every old link to the CURRENT one (no redirect chains).
 */

import { describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../test-utils/mockApiHandler';
import { accountUpdateStylistProfile_IO } from './operations/account-stylist-profile.operations';
import { resolveProfileLink_IO } from './profile-link-alias.operations';

vi.mock('@app/event-log/event-log.client', () => ({
  writeRawEventLog_IO: vi.fn(async () => undefined),
}));

type Alias = { kind: string; slug: string; account_id: string };
type Account = {
  account_id: string;
  vanity_url: string | null;
  salon_vanity_url: string | null;
};

const ANNA = 'acc_anna_000000000000000001';
const EWA = 'acc_ewa_0000000000000000001';

const accountRow = (account: Account) => ({
  ...account,
  pricing_plan: 'FREE',
  payment_status: 'UNPAID',
  account_status: 'ACTIVE',
  subscription_status: null,
});

/** In-memory database with the uniqueness rules of the real schema. */
const fakeDb = (accounts: Account[], aliases: Alias[] = []) => {
  const events: string[] = [];
  const byKey = (kind: string, slug: string) =>
    aliases.find(a => a.kind === kind && a.slug === slug) ?? null;
  const db = {
    stylistAccount: {
      findFirst: async ({
        where,
      }: {
        where: { OR: Array<{ vanity_url?: string; account_id?: string }> };
      }) =>
        accounts.find(a =>
          where.OR.some(
            c =>
              (c.vanity_url !== undefined && a.vanity_url === c.vanity_url) ||
              (c.account_id !== undefined && a.account_id === c.account_id)
          )
        ) ?? null,
      findUnique: async ({ where }: { where: { account_id: string } }) => {
        events.push('read-current');
        return accounts.find(a => a.account_id === where.account_id) ?? null;
      },
      update: async ({
        where,
        data,
      }: {
        where: { account_id: string };
        data: Partial<Account>;
      }) => {
        const row = accounts.find(a => a.account_id === where.account_id);
        if (!row) {
          throw Object.assign(new Error('not found'), { code: 'P2025' });
        }
        Object.assign(row, data);
        return accountRow(row);
      },
    },
    profileLinkAlias: {
      findUnique: async ({
        where,
      }: {
        where: { kind_slug: { kind: string; slug: string } };
      }) => byKey(where.kind_slug.kind, where.kind_slug.slug),
      deleteMany: async ({ where }: { where: Alias }) => {
        const before = aliases.length;
        aliases.splice(
          0,
          aliases.length,
          ...aliases.filter(
            a =>
              !(
                a.kind === where.kind &&
                a.slug === where.slug &&
                a.account_id === where.account_id
              )
          )
        );
        return { count: before - aliases.length };
      },
      createMany: async ({ data }: { data: Alias[] }) => {
        let count = 0;
        for (const row of data) {
          if (!byKey(row.kind, row.slug)) {
            aliases.push({ ...row });
            count += 1;
          }
        }
        return { count };
      },
      findFirst: async ({
        where,
      }: {
        where: { kind: string; slug: string };
      }) => {
        const alias = byKey(where.kind, where.slug);
        const account = alias
          ? accounts.find(a => a.account_id === alias.account_id)
          : undefined;
        return account ? { account } : null;
      },
    },
  };
  // The operation runs DB_CLIENT.use.$transaction(fn); the callback gets the same stubs as `tx`.
  const use: typeof db & {
    $transaction: (fn: (tx: unknown) => unknown) => unknown;
    $queryRaw: () => Promise<Array<{ account_id: string }>>;
  } = {
    ...db,
    $queryRaw: async () => {
      events.push('lock-owner');
      return [{ account_id: ANNA }];
    },
    $transaction: async fn => fn(use),
  };
  mockDb(use as never);
  return { accounts, aliases, events };
};

const changeVanity = (account_id: string, vanity_url: string | null) =>
  accountUpdateStylistProfile_IO({
    account_id,
    created_by_user_id: `usr_${account_id}`,
    stylist_pricing_plan: 'FREE',
    body: { vanity: { vanity_url } },
  });

describe('retired stylist links', () => {
  it('locks the owner before reading the previous vanity on a vanity-only save', async () => {
    const state = fakeDb([
      { account_id: ANNA, vanity_url: 'link-a', salon_vanity_url: null },
    ]);
    expect((await changeVanity(ANNA, 'link-b')).success).toBe(true);
    expect(state.events.indexOf('lock-owner')).toBeGreaterThanOrEqual(0);
    expect(state.events.indexOf('lock-owner')).toBeLessThan(
      state.events.indexOf('read-current')
    );
  });
  it('reserves the old link for her account when she changes it', async () => {
    const state = fakeDb([
      { account_id: ANNA, vanity_url: 'anna-nails', salon_vanity_url: null },
    ]);

    const result = await changeVanity(ANNA, 'anna-studio');

    expect(result.success).toBe(true);
    expect(state.accounts[0]?.vanity_url).toBe('anna-studio');
    expect(state.aliases).toEqual([
      { kind: 'STYLIST', slug: 'anna-nails', account_id: ANNA },
    ]);
  });

  it('lets her take back an earlier link of her own', async () => {
    const state = fakeDb(
      [{ account_id: ANNA, vanity_url: 'anna-studio', salon_vanity_url: null }],
      [{ kind: 'STYLIST', slug: 'anna-nails', account_id: ANNA }]
    );

    const result = await changeVanity(ANNA, 'anna-nails');

    expect(result.success).toBe(true);
    expect(state.accounts[0]?.vanity_url).toBe('anna-nails');
    expect(state.aliases).toEqual([
      { kind: 'STYLIST', slug: 'anna-studio', account_id: ANNA },
    ]);
  });

  it('treats another stylist’s retired link as taken', async () => {
    const state = fakeDb(
      [
        { account_id: ANNA, vanity_url: 'anna-studio', salon_vanity_url: null },
        { account_id: EWA, vanity_url: 'ewa', salon_vanity_url: null },
      ],
      [{ kind: 'STYLIST', slug: 'anna-nails', account_id: ANNA }]
    );

    const result = await changeVanity(EWA, 'anna-nails');

    expect(result).toEqual({
      success: false,
      error: { type: 'ACCOUNT_VANITY_URL_TAKEN', vanityUrl: 'anna-nails' },
    });
    expect(state.accounts[1]?.vanity_url).toBe('ewa');
    expect(state.aliases).toHaveLength(1);
  });

  it('resolves every link of a chain to the current one', async () => {
    const state = fakeDb([
      { account_id: ANNA, vanity_url: 'link-a', salon_vanity_url: null },
    ]);
    await changeVanity(ANNA, 'link-b');
    await changeVanity(ANNA, 'link-c');

    expect(state.aliases.map(a => a.slug).sort()).toEqual(['link-a', 'link-b']);
    for (const slug of ['link-a', 'link-b']) {
      expect(await resolveProfileLink_IO({ kind: 'STYLIST', slug })).toEqual({
        success: true,
        data: { account_id: ANNA, current_slug: 'link-c' },
      });
    }
  });

  it('answers not found for a slug that was never a link', async () => {
    fakeDb([
      { account_id: ANNA, vanity_url: 'anna-nails', salon_vanity_url: null },
    ]);
    const result = await resolveProfileLink_IO({
      kind: 'STYLIST',
      slug: 'nobody',
    });
    expect(result.success).toBe(false);
  });

  it('resolves to the id route once she clears her link', async () => {
    fakeDb([
      { account_id: ANNA, vanity_url: 'anna-nails', salon_vanity_url: null },
    ]);
    await changeVanity(ANNA, null);
    expect(
      await resolveProfileLink_IO({ kind: 'STYLIST', slug: 'anna-nails' })
    ).toEqual({
      success: true,
      data: { account_id: ANNA, current_slug: null },
    });
  });
});
