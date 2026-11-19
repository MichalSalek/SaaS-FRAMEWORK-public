import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../src/prisma/js-client';
import type { AuthDb } from './auth-db.fixture';
import { createSessionActivityDb } from './session-activity.fixture';

const holder = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    get use() {
      if (!holder.client) {
        throw new Error('No test DB');
      }
      return holder.client;
    },
  },
}));
vi.mock('@app/event-log/event-log.client', () => ({
  writeRawEventLog_IO: vi.fn(async () => undefined),
}));
import { assignAutoVanityUrl_IO } from '@domain/account/vanity-url.auto';
import { accountUpdateStylistProfile_IO } from '@domain/account/operations/account-stylist-profile.operations';

const url = process.env.SESSION_ACTIVITY_TEST_DATABASE_URL;
describe.skipIf(!url)('profile-link namespace on real PostgreSQL', () => {
  let db: AuthDb;
  beforeAll(async () => {
    db = await createSessionActivityDb(url ?? '');
    holder.client = db.seeder;
  }, 120_000);
  afterAll(async () => {
    holder.client = null;
    await db?.drop();
  });

  it('does not auto-assign a slug retired between the two initial reads', async () => {
    await db.seedUser('link_old', 'STYLIST');
    await db.seedUser('link_new', 'STYLIST');
    await db.seeder.stylistAccount.update({
      where: { account_id: 'sa_link_old' },
      data: { vanity_url: 'anna' },
    });
    let release!: () => void;
    let observed!: () => void;
    const waitForRetirement = new Promise<void>(resolve => {
      release = resolve;
    });
    const aliasRead = new Promise<void>(resolve => {
      observed = resolve;
    });
    const client = db.seeder;
    holder.client = new Proxy(client, {
      get(target, key, receiver) {
        if (key === 'stylistAccount') {
          return new Proxy(target.stylistAccount, {
            get(model, field, r) {
              if (field === 'findMany') {
                return async (...args: unknown[]) => {
                  await waitForRetirement;
                  return Reflect.apply(model.findMany, model, args);
                };
              }
              return Reflect.get(model, field, r);
            },
          });
        }
        if (key === 'profileLinkAlias') {
          return new Proxy(target.profileLinkAlias, {
            get(model, field, r) {
              if (field === 'findMany') {
                return async (...args: unknown[]) => {
                  const rows = await Reflect.apply(model.findMany, model, args);
                  observed();
                  return rows;
                };
              }
              return Reflect.get(model, field, r);
            },
          });
        }
        const value = Reflect.get(target, key, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const auto = assignAutoVanityUrl_IO('sa_link_new', ['Anna']);
    try {
      await aliasRead;
      const changed = await accountUpdateStylistProfile_IO({
        account_id: 'sa_link_old',
        created_by_user_id: db.idOf('link_old'),
        stylist_pricing_plan: 'FREE',
        body: { vanity: { vanity_url: 'anna-new' } },
      });
      expect(changed.success).toBe(true);
    } finally {
      release();
      await auto;
      holder.client = client;
    }
    expect(
      (
        await client.stylistAccount.findUniqueOrThrow({
          where: { account_id: 'sa_link_new' },
        })
      ).vanity_url
    ).toBeNull();
    expect(
      await client.profileLinkAlias.findUnique({
        where: { kind_slug: { kind: 'STYLIST', slug: 'anna' } },
      })
    ).toMatchObject({ account_id: 'sa_link_old' });
  }, 120_000);
});
