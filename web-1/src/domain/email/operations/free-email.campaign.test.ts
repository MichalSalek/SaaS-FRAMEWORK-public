import { describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { initializeFreeEmailCampaign_IO } from './free-email.enrollment';
const start = new Date('2026-10-19T12:00:00Z');
describe('Free campaign restart and reenable', () => {
  it('preserves the launch cutoff across repeated OFF startup calls', async () => {
    let stored: {
      id: string;
      mode: string;
      startedAt: Date;
      initializedAt: Date | null;
    } | null = null;
    const create = vi.fn(
      async ({
        data,
      }: {
        data: { id: string; mode: string; startedAt: Date };
      }) => {
        stored = { ...data, initializedAt: null };
        return stored;
      }
    );
    mockDb({
      runtimeConfig: { findUnique: async () => ({ value: 'OFF' }) },
      emailLifecycleCampaign: { findUnique: async () => stored, create },
    });
    const first = await initializeFreeEmailCampaign_IO(start);
    const second = await initializeFreeEmailCampaign_IO(
      new Date(start.getTime() + 86400000)
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(first.startedAt).toEqual(start);
    expect(second.startedAt).toEqual(start);
  });
  it('OFF/PREVIEW/ON cycling cannot recapture or reset an initialized cohort', async () => {
    const captured = new Date(start.getTime() + 1000);
    const stored = {
      id: 'free-onboarding-v1',
      mode: 'ON',
      startedAt: start,
      initializedAt: captured,
    };
    let desired = 'OFF';
    const createMany = vi.fn();
    mockDb({
      runtimeConfig: { findUnique: async () => ({ value: desired }) },
      emailLifecycleCampaign: {
        findUnique: async () => stored,
        update: async ({ data }: { data: { mode: string } }) => {
          stored.mode = data.mode;
          return stored;
        },
      },
      freeEmailEnrollment: { createMany },
    });
    for (const mode of ['OFF', 'PREVIEW', 'ON', 'ON']) {
      desired = mode;
      const result = await initializeFreeEmailCampaign_IO(
        new Date(start.getTime() + 10 * 86400000)
      );
      expect(result).toMatchObject({
        mode,
        startedAt: start,
        initializedAt: captured,
      });
    }
    expect(createMany).not.toHaveBeenCalled();
  });
});

it('caps the cohort before a complete primary-key suppression lookup', async () => {
  const { lifecycleAddressHash } =
    await import('@app/email-handler/lifecycle/ledger');
  const rows = Array.from({ length: 10000 }, (_, i) => ({
    accountId: `a${i}`,
    userId: `u${i}`,
    email: `u${i}@example.test`,
  }));
  const raw = vi.fn(async () => rows);
  const suppression = vi.fn(
    async ({
      where,
      take,
    }: {
      where: { addressHash: { in: string[] } };
      take: number;
    }) =>
      [...new Set(where.addressHash.in)]
        .slice(0, take)
        .map(addressHash => ({ addressHash }))
  );
  const createMany = vi.fn();
  const campaign = {
    id: 'free-onboarding-v1',
    mode: 'ON',
    startedAt: start,
    initializedAt: null,
  };
  mockDb({
    $queryRaw: raw as unknown as Record<string, (...args: never[]) => unknown>,
    runtimeConfig: { findUnique: async () => ({ value: 'ON' }) },
    emailLifecycleCampaign: {
      findUnique: async () => campaign,
      update: async () => campaign,
    },
    emailDeliverySuppression: { findMany: suppression },
    freeEmailEnrollment: { createMany },
  });
  await initializeFreeEmailCampaign_IO(start);
  const suppressionCall = suppression.mock.calls[0]?.[0];
  const lastRow = rows.at(-1);
  if (!suppressionCall || !lastRow) {
    throw new Error('expected suppression lookup and final row');
  }
  expect(suppressionCall.take).toBeGreaterThanOrEqual(rows.length);
  expect(suppressionCall.where.addressHash.in).toContain(
    lifecycleAddressHash(lastRow.email)
  );
  expect(createMany).not.toHaveBeenCalled();
  raw.mockResolvedValue([
    ...rows,
    { accountId: 'extra', userId: 'extra', email: 'extra@example.test' },
  ]);
  suppression.mockClear();
  await expect(initializeFreeEmailCampaign_IO(start)).rejects.toThrow(
    'snapshot bound'
  );
  expect(suppression).not.toHaveBeenCalled();
});
