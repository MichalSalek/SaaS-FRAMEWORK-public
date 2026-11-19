/** Coordinator acceptance against an isolated real PostgreSQL schema; Stripe alone is fake. */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { PrismaClient } from '../../src/prisma/js-client';
import { createAuthDb, type AuthDb } from './auth-db.fixture';
import type Stripe from 'stripe';
import {
  FakeStripe,
  gate,
  createAccount,
  expectSameCreate,
  assertFreeCasFenced,
  assertPreparedFreeInterleave,
} from './checkout-attempt-flow.pg.fixture';

const holder = vi.hoisted(() => ({
  client: null as PrismaClient | null,
  stripe: null as unknown,
}));
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
vi.mock('@app/stripe/adapters/stripe.adapter', () => ({
  getStripe: () => holder.stripe,
}));
import {
  runCheckoutAttempt_IO,
  retireCheckoutAttempt_IO,
} from '@domain/account/operations/checkout-attempt.operations';
import { prismaCheckoutAttemptStore as store } from '@domain/account/operations/checkout-attempt.store';

const url =
  process.env.CHECKOUT_ATTEMPT_DATABASE_URL ??
  process.env.CHECKOUT_ATTEMPT_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname) ||
    !/^\/nf_(ci|checkout_[a-z0-9_]+)$/.test(parsed.pathname)
  ) {
    throw new Error(
      'Checkout acceptance requires a disposable loopback nf_ci or nf_checkout_* database'
    );
  }
}

describe.skipIf(!url)('durable checkout coordinator on real Postgres', () => {
  let db: AuthDb;
  let stripe: FakeStripe;
  let sequence = 0;
  const account = (customer = true) =>
    createAccount(db, `checkout_${++sequence}`, customer);
  const run = (a: Awaited<ReturnType<typeof account>>, intent = a.intent) =>
    runCheckoutAttempt_IO({ intent, prepare: a.prepare });
  const sessionId = (result: Awaited<ReturnType<typeof run>>) => {
    if (result.success === false) {
      throw new Error(JSON.stringify(result.error));
    }
    return result.data.session.id;
  };
  const releaseLease = (accountId: string) =>
    db.seeder
      .$executeRaw`UPDATE "CheckoutAttempt" SET lease_expires_at = now() - interval '1 second' WHERE account_id = ${accountId}`;
  beforeAll(async () => {
    vi.stubEnv('DIRECT_DATABASE_URL', url ?? '');
    vi.stubEnv('SHADOW_DATABASE_URL', '');
    db = await createAuthDb(url ?? '');
    holder.client = db.seeder;
  }, 120000);
  beforeEach(() => {
    stripe = new FakeStripe();
    holder.stripe = stripe.api;
  });
  afterAll(async () => {
    await db?.drop();
    vi.unstubAllEnvs();
  });

  it('serializes concurrent same-intent requests with one confirmable session and immutable creation', async () => {
    const a = await account();
    const entered = gate();
    const release = gate();
    stripe.createHook = async () => {
      entered.release();
      await release.promise;
    };
    const first = run(a);
    await entered.promise;
    const other = await run(a);
    release.release();
    const one = await first;
    expect(other.success).toBe(false);
    const id = sessionId(one);
    stripe.createHook = undefined;
    expect(sessionId(await run(a))).toBe(id);
    expect(stripe.calls).toHaveLength(1);
    expect(a.prepare).toHaveBeenCalledTimes(1);
    expect(stripe.calls[0]?.options).toMatchObject({
      idempotencyKey: expect.stringMatching(/^nf-checkout-/),
      maxNetworkRetries: 0,
      timeout: expect.any(Number),
    });
    expect(stripe.calls[0]?.options.timeout).toBeLessThanOrEqual(8000);
    const attempt = await store.read(a.accountId);
    expect(stripe.calls[0]?.params.metadata?.attemptId).toBe(
      attempt?.attempt_id
    );
    expect(stripe.calls[0]?.params.subscription_data?.metadata?.attemptId).toBe(
      attempt?.attempt_id
    );
    expect(attempt?.stripe_params).not.toHaveProperty('client_secret');
    const accountAfter = await db.seeder.stylistAccount.findUniqueOrThrow({
      where: { account_id: a.accountId },
    });
    expect(accountAfter).toMatchObject({
      trial_started_at: null,
      payment_status: 'UNPAID',
      pricing_plan: 'FREE',
    });
  });

  it('expires and retrieves the previous session before creating a changed intent', async () => {
    const a = await account();
    const old = sessionId(await run(a));
    const changed = {
      ...a.intent,
      planId: 'PRO_PLUS' as const,
      currency: 'eur' as const,
    };
    const next = sessionId(await run(a, changed));
    expect(next).not.toBe(old);
    const exp = stripe.events.indexOf(`expire:${old}`);
    const verify = stripe.events.indexOf(`retrieve:${old}`, exp + 1);
    const create = stripe.events.lastIndexOf('create');
    expect(exp).toBeGreaterThanOrEqual(0);
    expect(verify).toBeGreaterThan(exp);
    expect(create).toBeGreaterThan(verify);
  });

  it('replays identical persisted params and key after a lost create response', async () => {
    const a = await account();
    let once = true;
    stripe.createHook = async () => {
      if (once) {
        once = false;
        throw new Error('connection lost');
      }
    };
    const firstResult = await run(a);
    const recovered = firstResult.success ? firstResult : await run(a);
    expect(sessionId(recovered)).toBe([...stripe.sessions.keys()][0]);
    expect(stripe.sessions.size).toBe(1);
    expect(stripe.keys.size).toBe(1);
    if (stripe.calls.length > 1) {
      expectSameCreate(stripe);
    }
    expect(a.prepare).toHaveBeenCalledTimes(1);
  });

  it('recovers the exact persisted preparation when a process dies before the provider receives it', async () => {
    const a = await account();
    const entered = gate();
    const release = gate();
    let first = true;
    stripe.beforeCreateHook = async () => {
      if (first) {
        first = false;
        entered.release();
        await release.promise;
      }
    };
    const crashed = run(a);
    await entered.promise;
    const saved = await store.read(a.accountId);
    expect(saved?.phase).toBe('preparing');
    expect(saved?.stripe_session_id).toBeNull();
    expect(saved?.stripe_params).toEqual(stripe.calls[0]?.params);
    await releaseLease(a.accountId);
    const recovered = await run(a);
    sessionId(recovered);
    release.release();
    await crashed;
    expect(stripe.calls).toHaveLength(2);
    expectSameCreate(stripe);
    expect(stripe.sessions.size).toBe(1);
    expect(a.prepare).toHaveBeenCalledTimes(1);
  });

  it('finds a created session by metadata after an ambiguous server error', async () => {
    const a = await account();
    stripe.createHook = async () => {
      throw Object.assign(new Error('cached server error'), {
        statusCode: 500,
        type: 'StripeAPIError',
      });
    };
    const firstResult = await run(a);
    const found = firstResult.success ? firstResult : await run(a);
    expect(sessionId(found)).toBe([...stripe.sessions.keys()][0]);
    expect(stripe.list).toHaveBeenCalled();
    expect(stripe.keys.size).toBe(1);
  });

  it('does not rotate after an ambiguous 500 with an empty lookup', async () => {
    const a = await account();
    stripe.lookupEmpty = true;
    stripe.createHook = async () => {
      throw Object.assign(new Error('cached server error'), {
        statusCode: 500,
        type: 'StripeAPIError',
      });
    };
    expect((await run(a)).success).toBe(false);
    expect((await run(a)).success).toBe(false);
    expect(stripe.keys.size).toBe(1);
    expect(stripe.sessions.size).toBe(1);
    expect(new Set(stripe.calls.map(c => c.options.idempotencyKey)).size).toBe(
      1
    );
    expect(stripe.list).toHaveBeenCalled();
  });

  it('does not let a stale lease writer replace the recovered result', async () => {
    const a = await account();
    const entered = gate();
    const release = gate();
    let first = true;
    stripe.createHook = async () => {
      if (first) {
        first = false;
        entered.release();
        await release.promise;
      }
    };
    const stale = run(a);
    await entered.promise;
    await releaseLease(a.accountId);
    const recovered = await run(a);
    const id = sessionId(recovered);
    release.release();
    await stale;
    const row = await store.read(a.accountId);
    expect(row?.stripe_session_id).toBe(id);
    expect(stripe.sessions.size).toBe(1);
  });

  it('blocks another create when completion wins the expiration race', async () => {
    const a = await account();
    const old = sessionId(await run(a));
    stripe.expireHook = async session => {
      session.status = 'complete';
    };
    const result = await run(a, { ...a.intent, planId: 'PRO_PLUS' });
    expect(result.success).toBe(false);
    expect(stripe.calls).toHaveLength(1);
    expect(stripe.sessions.get(old)?.status).toBe('complete');
  });

  it('rejects a scoped nonterminal provider subscription even with no database pointer', async () => {
    const a = await account();
    const planId = 'app-price-1';
    stripe.subs.push({
      id: 'sub_test',
      customer: a.customerId,
      status: 'active',
      metadata: { projectId: 'nailfolio', accountId: a.accountId, planId },
      items: { data: [{ price: { lookup_key: 'app-price-pro' } }] },
    } as unknown as Stripe.Subscription);
    expect((await run(a)).success).toBe(false);
    expect(stripe.calls).toHaveLength(0);
  });

  it('expires only exactly owned legacy sessions before new creation', async () => {
    const a = await account();
    const owned = stripe.add(a.customerId, {
      projectId: 'nailfolio',
      accountId: a.accountId,
    });
    const foreign = stripe.add(a.customerId, {
      projectId: 'other',
      accountId: a.accountId,
    });
    const wrongAccount = stripe.add(a.customerId, {
      projectId: 'nailfolio',
      accountId: 'other',
    });
    const unmarked = stripe.add(a.customerId, {});
    sessionId(await run(a));
    expect(stripe.expire.mock.calls.some(([id]) => id === owned.id)).toBe(true);
    expect(stripe.sessions.get(owned.id)?.status).toBe('expired');
    for (const s of [foreign, wrongAccount, unmarked]) {
      expect(stripe.sessions.get(s.id)?.status).toBe('open');
    }
  });

  it('leaves Stripe untouched when Free has no customer or attempt', async () => {
    const a = await account(false);
    expect(
      (
        await retireCheckoutAttempt_IO({
          userId: a.userId,
          accountId: a.accountId,
        })
      ).success
    ).toBe(true);
    expect(stripe.list).not.toHaveBeenCalled();
    expect(stripe.listSubscriptions).not.toHaveBeenCalled();
    expect(stripe.create).not.toHaveBeenCalled();
    expect(stripe.expire).not.toHaveBeenCalled();
  });

  it('retires an open attempt for Free, and blocks if completion wins', async () => {
    const a = await account();
    const id = sessionId(await run(a));
    expect(
      (
        await retireCheckoutAttempt_IO({
          userId: a.userId,
          accountId: a.accountId,
        })
      ).success
    ).toBe(true);
    expect(stripe.sessions.get(id)?.status).toBe('expired');
    const b = await account();
    sessionId(await run(b));
    stripe.expireHook = async session => {
      session.status = 'complete';
    };
    expect(
      (
        await retireCheckoutAttempt_IO({
          userId: b.userId,
          accountId: b.accountId,
        })
      ).success
    ).toBe(false);
  });

  it('fails closed when legacy listing does not reach its end', async () => {
    const a = await account();
    stripe.add(a.customerId, { projectId: 'other' });
    stripe.listHasMore = true;
    expect((await run(a)).success).toBe(false);
    expect(stripe.calls).toHaveLength(0);
    expect(stripe.list.mock.calls.length).toBeLessThanOrEqual(100);
  });
  it('fences Free CAS and serializes prepared trial with Free through lease expiry', async () => {
    await assertFreeCasFenced(db, await account());
    for (let i = 0; i < 3; i++) {
      await assertPreparedFreeInterleave(db, await account());
    }
  }, 30000);
});
