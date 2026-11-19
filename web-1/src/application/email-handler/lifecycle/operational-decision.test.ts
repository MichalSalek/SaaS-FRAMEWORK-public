import { describe, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    use: { emailLifecycleOperationalEvent: { createMany: io.write } },
  },
}));
import { recordLifecycleDecision_IO } from './operational-decision';
describe('lifecycle candidate decisions', () => {
  it('uses a stable deduplication identity across repeated sweeps', async () => {
    const input = {
      identity: 'enrollment-1',
      kind: 'suppressed' as const,
      reason: 'weekly_limit',
      family: 'free',
      templateId: 'free-first-photo',
      ruleId: 'free-first-photo',
      locale: 'en',
      cohort: 'existing',
      plannedAt: new Date('2026-10-20T12:00:00Z'),
      opportunityId: 'd1',
      now: new Date('2026-10-20T12:00:00Z'),
    };
    await recordLifecycleDecision_IO(input);
    await recordLifecycleDecision_IO(input);
    expect(io.write).toHaveBeenCalledTimes(2);
    expect(io.write).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        skipDuplicates: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            id: expect.stringMatching(/^[a-f0-9]{64}$/),
            dimensions: expect.objectContaining({
              plannedAt: '2026-10-20T12:00:00.000Z',
              opportunityId: 'd1',
            }),
          }),
        ]),
      })
    );
    const calls = io.write.mock.calls;
    expect(calls[0]).toEqual(calls[1]);
  });
});
