import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { findMany, updateMany, fetchMock, groupBy, createMany } = vi.hoisted(
  () => ({
    findMany: vi.fn(),
    updateMany: vi.fn(),
    fetchMock: vi.fn(),
    groupBy: vi.fn(),
    createMany: vi.fn(),
  })
);
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    use: {
      freeEmailEnrollment: { groupBy },
      emailLifecycleOperationalEvent: {
        findMany,
        updateMany,
        createMany,
      },
    },
  },
}));
vi.mock('@app/environment/environment.config', () => ({
  ENV_VARS: { POSTHOG_PROJECT_KEY: 'test-public-key' },
}));
vi.mock('@app/environment/environment.utils.api', () => ({
  IS_PRODUCTION_ENV: () => true,
}));
import {
  exportLifecycleOperations,
  operationalCapture,
  operationalExportFailureMode,
} from './operational-export';
const row = {
  id: 'stable-not-uuid-row',
  messageId: 'opaque-message',
  kind: 'send_result',
  state: 'accepted',
  reason: null,
  dimensions: {
    family: 'free',
    templateId: 'free-first-photo',
    locale: 'pl',
    cohort: 'new',
    transport: 'resend',
    email: 'private@example.org',
    userId: 'private-user',
  },
  occurredAt: new Date('2026-10-20T12:00:00Z'),
};

describe('operational lifecycle export', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T12:30:00Z'));
    vi.clearAllMocks();
    groupBy.mockResolvedValue([]);
    createMany.mockResolvedValue({ count: 0 });
    vi.stubGlobal('fetch', fetchMock);
    findMany.mockResolvedValue([row]);
    updateMany.mockResolvedValue({ count: 1 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it('exports only explicitly allowed dimensions with stable UUID and original timestamp', () => {
    const first = operationalCapture(row);
    expect(first).toEqual(operationalCapture(row));
    expect(first.uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(first.timestamp).toBe(row.occurredAt.toISOString());
    expect(JSON.stringify(first)).not.toContain('private');
    expect(first.properties).toMatchObject({
      distinct_id: 'email-operations',
      $process_person_profile: false,
      lifecycle_template: 'free-first-photo',
    });
  });
  it('replaces free-text provider errors so addresses cannot leak in reasons', () => {
    expect(
      operationalCapture({
        ...row,
        reason: 'Rejected recipient private@example.org',
      }).properties.lifecycle_reason
    ).toBe('provider_error');
  });
  it('exports cohort progress only as totals, including explicit zeroes when a group is empty', async () => {
    groupBy.mockResolvedValue([
      {
        cohort: 'new',
        status: 'active',
        finishReason: null,
        _count: { _all: 2 },
      },
      {
        cohort: 'new',
        status: 'finished',
        finishReason: 'completed',
        _count: { _all: 1 },
      },
    ]);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 1 }),
    });
    await exportLifecycleOperations();
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            kind: 'cohort_snapshot',
            dimensions: {
              cohort: 'new',
              family: 'free',
              count: 3,
              active: 2,
              finished: 1,
              completed: 1,
            },
          }),
          expect.objectContaining({
            kind: 'cohort_snapshot',
            dimensions: {
              cohort: 'existing',
              family: 'free',
              count: 0,
              active: 0,
              finished: 0,
              completed: 0,
            },
          }),
        ]),
        skipDuplicates: true,
      })
    );
  });
  it.each([1, 'Ok'])(
    'marks only the exact acknowledged event rows exported (%s)',
    async status => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ status }),
      });
      expect(await exportLifecycleOperations()).toBe(1);
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: [row.id] }, exportedAt: null },
        })
      );
    }
  );
  it('keeps ambiguous exports pending and repeats identical payloads after a restart', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 1 }) });
    await expect(exportLifecycleOperations()).rejects.toThrow('timeout');
    expect(updateMany).not.toHaveBeenCalled();
    await exportLifecycleOperations();
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      fetchMock.mock.calls[1]?.[1]?.body
    );
  });
  it('does not mark export complete on HTTP success without an ingestion acknowledgment', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await expect(exportLifecycleOperations()).rejects.toThrow(
      'brak potwierdzenia'
    );
    expect(updateMany).not.toHaveBeenCalled();
  });
  it.each([
    ['2026-10-21T11:59:59Z', 'warn'],
    ['2026-10-21T12:00:00Z', 'error'],
  ])(
    'escalates unexported data by its durable age at %s',
    async (now, mode) => {
      vi.setSystemTime(new Date(now));
      const cause = new Error('timeout');
      fetchMock.mockRejectedValue(cause);

      const failure: unknown = await exportLifecycleOperations().catch(
        (error: unknown) => error
      );

      expect(operationalExportFailureMode(failure)).toBe(mode);
      expect(failure).toMatchObject({ cause, pendingBatchSize: 1 });
      expect(updateMany).not.toHaveBeenCalled();
    }
  );
  it('does not downgrade database or unrelated sweep failures', () => {
    expect(
      operationalExportFailureMode(new Error('database unavailable'))
    ).toBe('error');
  });
  it('keeps persistence failures as errors even after PostHog acknowledged ingestion', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 1 }),
    });
    updateMany.mockRejectedValueOnce(new Error('database unavailable'));
    const failure: unknown = await exportLifecycleOperations().catch(
      (error: unknown) => error
    );
    expect(operationalExportFailureMode(failure)).toBe('error');
  });
  it.each([
    [401, 'error'],
    [429, 'warn'],
    [503, 'warn'],
  ])('classifies an ingestion HTTP %i response as %s', async (status, mode) => {
    fetchMock.mockResolvedValue({ ok: false, status });
    const failure: unknown = await exportLifecycleOperations().catch(
      (error: unknown) => error
    );
    expect(operationalExportFailureMode(failure)).toBe(mode);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

it('keeps an unavailable frequency window distinct from provider failure', () => {
  expect(
    operationalCapture({
      ...row,
      kind: 'suppressed',
      state: 'suppressed',
      reason: 'frequency_unavailable',
    }).properties.lifecycle_reason
  ).toBe('frequency_unavailable');
});
