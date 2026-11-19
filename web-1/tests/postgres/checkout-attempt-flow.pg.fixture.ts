import { randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import type Stripe from 'stripe';
import { success } from '@kernel/application/result.types';
import type { CheckoutAttemptIntent } from '@domain/account/operations/checkout-attempt.types';
import type { AuthDb } from './auth-db.fixture';

type Session = Stripe.Checkout.Session;
type Params = Stripe.Checkout.SessionCreateParams;
type RequestOptions = Stripe.RequestOptions;
export const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => {
    release = resolve;
  });
  return { promise, release };
};

/** Models idempotency and observable provider state; no application-side algorithm is replaced. */
export class FakeStripe {
  sessions = new Map<string, Session>();
  keys = new Map<string, Session>();
  calls: Array<{ params: Params; options: RequestOptions }> = [];
  events: string[] = [];
  subs: Stripe.Subscription[] = [];
  beforeCreateHook?: (() => Promise<void>) | undefined;
  createHook?: ((session: Session) => Promise<void>) | undefined;
  expireHook?: ((session: Session) => Promise<void>) | undefined;
  listHasMore = false;
  lookupEmpty = false;
  create = vi.fn(async (params: Params, options: RequestOptions) => {
    this.calls.push({
      params: structuredClone(params),
      options: structuredClone(options),
    });
    this.events.push('create');
    await this.beforeCreateHook?.();
    const key = options.idempotencyKey;
    if (!key) {
      throw new Error('missing idempotency key');
    }
    let session = this.keys.get(key);
    if (!session) {
      session = {
        id: `cs_${randomUUID()}`,
        object: 'checkout.session',
        mode: 'subscription',
        status: 'open',
        customer: params.customer ?? null,
        metadata: params.metadata ?? {},
        client_secret: 'cs_test_secret',
        url: 'https://example.test/checkout',
        subscription: null,
        expires_at: params.expires_at,
      } as Session;
      this.sessions.set(session.id, session);
      this.keys.set(key, session);
    }
    await this.createHook?.(session);
    return structuredClone(session);
  });
  retrieve = vi.fn(async (id: string) => {
    this.events.push(`retrieve:${id}`);
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`unknown fake session ${id}`);
    }
    return structuredClone(session);
  });
  expire = vi.fn(async (id: string) => {
    this.events.push(`expire:${id}`);
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`unknown fake session ${id}`);
    }
    await this.expireHook?.(session);
    if (session.status === 'complete') {
      throw new Error('session already complete');
    }
    session.status = 'expired';
    return structuredClone(session);
  });
  list = vi.fn(async (params: Stripe.Checkout.SessionListParams) => {
    this.events.push('list');
    const rows = this.lookupEmpty
      ? []
      : [...this.sessions.values()].filter(
          s =>
            s.customer === params.customer &&
            (!params.status || s.status === params.status)
        );
    const after = params.starting_after
      ? rows.findIndex(s => s.id === params.starting_after) + 1
      : 0;
    const page = rows.slice(after, after + (params.limit ?? 10));
    return {
      object: 'list',
      data: structuredClone(page),
      has_more: this.listHasMore || after + page.length < rows.length,
      url: '/v1/checkout/sessions',
    };
  });
  listSubscriptions = vi.fn(async (params: Stripe.SubscriptionListParams) => ({
    object: 'list',
    data: structuredClone(
      this.subs.filter(s => s.customer === params.customer)
    ),
    has_more: false,
    url: '/v1/subscriptions',
  }));
  api = {
    checkout: {
      sessions: {
        create: this.create,
        retrieve: this.retrieve,
        expire: this.expire,
        list: this.list,
      },
    },
    subscriptions: { list: this.listSubscriptions },
  };
  add(
    customer: string,
    metadata: Record<string, string>,
    status: Session['status'] = 'open'
  ) {
    const session = {
      id: `cs_${randomUUID()}`,
      object: 'checkout.session',
      mode: 'subscription',
      customer,
      metadata,
      status,
      subscription: null,
      expires_at: Math.floor(Date.now() / 1000) + 86400,
    } as Session;
    this.sessions.set(session.id, session);
    return session;
  }
}

const meta = {
  returnUrl: 'https://example.test/return',
  billingAddressRequired: false,
  promoRejected: false,
};
export async function createAccount(
  db: AuthDb,
  key: string,
  customer: boolean
) {
  await db.seedUser(key, 'STYLIST');
  const userId = db.idOf(key);
  const accountId = `sa_${key}`;
  const customerId = `cus_${key}`;
  await db.seeder.stylistAccount.update({
    where: { account_id: accountId },
    data: {
      stripe_customer_id: customer ? customerId : null,
      payment_status: 'UNPAID',
      trial_started_at: null,
    },
  });
  const intent: CheckoutAttemptIntent = {
    userId,
    accountId,
    planId: 'PRO',
    billingPeriod: 'month',
    currency: 'pln',
    automaticTax: false,
    ...{ mode: 'custom', expectedTrialDays: 0 },
  };
  const metadata = { projectId: 'nailfolio', accountId, planId: 'app-price-1' };
  const prepare = vi.fn(async () =>
    success({
      params: {
        mode: 'subscription' as const,
        customer: customerId,
        ui_mode: 'custom' as const,
        line_items: [{ price: 'price_test', quantity: 1 }],
        return_url: meta.returnUrl,
        client_reference_id: userId,
        metadata,
        subscription_data: { metadata },
      },
      meta,
    })
  );
  return { intent, prepare, customerId, accountId, userId };
}

export const expectSameCreate = (stripe: FakeStripe) => {
  expect(JSON.stringify(stripe.calls[1]?.params)).toBe(
    JSON.stringify(stripe.calls[0]?.params)
  );
  expect(stripe.calls[1]?.options.idempotencyKey).toBe(
    stripe.calls[0]?.options.idempotencyKey
  );
};

const waitForLock = async (db: AuthDb, pattern: string) => {
  for (let i = 0; i < 150; i++) {
    const rows = await db.seeder.$queryRaw<
      Array<{ pid: number; blockers: number[] }>
    >`SELECT pid, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${pattern}`;
    if (rows[0]) {
      return rows[0];
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Expected lock waiter: ${pattern}`);
};

/** Prove the real Free CAS keeps its lease row locked until the account write commits. */
export async function assertFreeCasFenced(
  db: AuthDb,
  a: Awaited<ReturnType<typeof createAccount>>
) {
  const { prismaCheckoutAttemptStore: store } =
    await import('@domain/account/operations/checkout-attempt.store');
  const { selectFreePlan_IO } =
    await import('@domain/account/operations/account-free-selection.operations');
  const old = randomUUID();
  const owner = randomUUID();
  const successor = randomUUID();
  await db.seeder.stylistAccount.update({
    where: { account_id: a.accountId },
    data: { pricing_plan: 'PRO', payment_status: 'PAID' },
  });
  await store.claim(a.accountId, old);
  await db.seeder
    .$executeRaw`UPDATE "CheckoutAttempt" SET lease_expires_at = now() - interval '1 second' WHERE account_id = ${a.accountId}`;
  const stale = await selectFreePlan_IO({
    userId: a.userId,
    checkoutLease: { accountId: a.accountId, owner: old },
  });
  expect(stale.success).toBe(false);
  expect(
    await db.seeder.stylistAccount.findUniqueOrThrow({
      where: { account_id: a.accountId },
      select: { pricing_plan: true, payment_status: true },
    })
  ).toEqual({ pricing_plan: 'PRO', payment_status: 'PAID' });
  expect(await store.claim(a.accountId, owner)).not.toBeNull();
  await db.seeder
    .$executeRaw`UPDATE "CheckoutAttempt" SET lease_expires_at = now() + interval '2 seconds' WHERE account_id = ${a.accountId}`;
  const blocker = db.makeClient().client;
  const locked = gate();
  const release = gate();
  const blocked = blocker.$transaction(
    async tx => {
      await tx.$queryRaw`SELECT account_id FROM "StylistAccount" WHERE account_id = ${a.accountId} FOR UPDATE`;
      locked.release();
      await release.promise;
    },
    { timeout: 15000 }
  );
  await locked.promise;
  const free = selectFreePlan_IO({
    userId: a.userId,
    checkoutLease: { accountId: a.accountId, owner },
  });
  let next: ReturnType<typeof store.claim> | undefined;
  try {
    await waitForLock(db, '%WITH live_lease%');
    await new Promise(resolve => setTimeout(resolve, 2200));
    next = store.claim(a.accountId, successor);
    await waitForLock(db, '%INSERT INTO "CheckoutAttempt"%');
  } finally {
    release.release();
    await blocked;
  }
  expect((await free).success).toBe(true);
  expect(await next).toMatchObject({ lease_owner: successor });
  expect(
    await db.seeder.stylistAccount.findUniqueOrThrow({
      where: { account_id: a.accountId },
      select: { pricing_plan: true, payment_status: true },
    })
  ).toEqual({ pricing_plan: 'FREE', payment_status: 'UNPAID' });
}

/** Competing production statements must lock attempt then account and recheck expired leases. */
export async function assertPreparedFreeInterleave(
  db: AuthDb,
  a: Awaited<ReturnType<typeof createAccount>>
) {
  const { prismaCheckoutAttemptStore: store } =
    await import('@domain/account/operations/checkout-attempt.store');
  const { selectFreePlan_IO } =
    await import('@domain/account/operations/account-free-selection.operations');
  const owner = randomUUID();
  const attemptId = randomUUID();
  await store.claim(a.accountId, owner);
  await store.start({
    accountId: a.accountId,
    owner,
    attemptId,
    fingerprint: 'test',
    intentJson: '{}',
  });
  await db.seeder
    .$executeRaw`UPDATE "CheckoutAttempt" SET lease_expires_at = clock_timestamp() + interval '2 seconds' WHERE account_id = ${a.accountId}`;
  const locked = gate();
  const release = gate();
  const blocking = db.makeClient().client.$transaction(
    async tx => {
      await tx.$queryRaw`SELECT account_id FROM "StylistAccount" WHERE account_id = ${a.accountId} FOR UPDATE`;
      locked.release();
      await release.promise;
    },
    { timeout: 15000 }
  );
  await locked.promise;
  const prepared = store.prepared({
    accountId: a.accountId,
    owner,
    attemptId,
    customerId: a.customerId,
    paramsJson: JSON.stringify({
      subscription_data: { trial_period_days: 30 },
    }),
    metaJson: '{}',
  });
  let free: ReturnType<typeof selectFreePlan_IO> | undefined;
  try {
    const preparing = await waitForLock(db, '%eligible_trial_account%');
    free = selectFreePlan_IO({
      userId: a.userId,
      checkoutLease: { accountId: a.accountId, owner },
    });
    const freeWaiter = await waitForLock(db, '%WITH live_lease%');
    expect(freeWaiter.blockers).toContain(preparing.pid);
    await new Promise(resolve => setTimeout(resolve, 2200));
  } finally {
    release.release();
    await blocking;
  }
  expect(await prepared).toBeNull();
  expect((await free)?.success).toBe(false);
  expect(await store.read(a.accountId)).toMatchObject({
    stripe_params: null,
    customer_id: null,
    phase: 'preparing',
  });
  expect(
    await db.seeder.stylistAccount.findUniqueOrThrow({
      where: { account_id: a.accountId },
      select: {
        trial_started_at: true,
        payment_status: true,
        plan_selected_at: true,
      },
    })
  ).toEqual({
    trial_started_at: null,
    payment_status: 'UNPAID',
    plan_selected_at: null,
  });
}
