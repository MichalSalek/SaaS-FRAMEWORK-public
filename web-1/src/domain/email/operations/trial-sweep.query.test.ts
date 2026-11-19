import { describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { TRIAL_EMAIL_SCHEDULE } from '@kernel/domain/email/email-schedule.config';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { trialDueStartWindows } from '@domain/email/trial-audience.policy';
vi.mock('@app/email-handler/lifecycle/email-frequency.guard', () => ({
  batchGetEmailFrequencyCounts_IO: async () => new Map(),
}));
vi.mock('@app/email-handler/lifecycle/email-locale-batch.resolver', () => ({
  batchResolveLocales: async () => new Map(),
}));
import {
  buildTrialSweepContext,
  queryTrialAccounts,
  type TrialAccountRow,
} from './trial-sweep.query';

describe('trial email dedup lookup', () => {
  it('does not spend page slots on windows belonging only to disabled billing warnings', async () => {
    const findMany = vi.fn(async (..._args: unknown[]) => []);
    mockDb({ stylistAccount: { findMany } });
    const now = new Date('2026-11-09T12:00:00Z');
    await queryTrialAccounts(now, null);
    const query = findMany.mock.calls[0]?.[0] as {
      where: { AND: [{ OR: unknown[] }] };
    };
    const enabled = TRIAL_EMAIL_SCHEDULE.filter(
      rule => !['trial-warning', 'trial-last-day'].includes(rule.bodyTemplateId)
    );
    const offsets = (anchor: 'trial_start' | 'trial_end') =>
      enabled
        .filter(rule => rule.triggerAnchor === anchor)
        .map(rule => rule.triggerOffsetDays);
    expect(query.where.AND[0].OR).toEqual([
      ...trialDueStartWindows(offsets('trial_start'), now).map(
        trial_started_at => ({
          trial_started_at,
        })
      ),
      ...trialDueStartWindows(offsets('trial_end'), now).map(trial_ends_at => ({
        trial_ends_at,
      })),
    ]);
  });
  it('keeps every user/event pair even when one user has many duplicate rows', async () => {
    const event = TRIAL_EMAIL_SCHEDULE[0]?.infoEvent;
    if (!event) {
      throw new Error('expected a trial email schedule');
    }
    const rows = [
      ...Array.from({ length: 101 }, () => ({
        created_by_user_id: 'a',
        event,
      })),
      { created_by_user_id: 'b', event },
    ];
    mockDb({
      clientStylistPair: { groupBy: vi.fn(async () => []) },
      eventLog: {
        findMany: vi.fn(async (query: { take?: number }) =>
          rows.slice(0, query.take)
        ),
        groupBy: vi.fn(async () => [
          { created_by_user_id: 'a', event },
          { created_by_user_id: 'b', event },
        ]),
      },
    });
    const accounts = ['a', 'b'].map(id => ({
      account_id: id,
      created_by_user_id: id,
      trial_started_at: new Date('2026-01-01'),
      pricing_plan: PricingPlanValue.PRO,
    })) as unknown as TrialAccountRow[];
    const context = await buildTrialSweepContext(accounts);
    expect(context.sentEventsMap.get('a')?.has(event)).toBe(true);
    expect(context.sentEventsMap.get('b')?.has(event)).toBe(true);
  });
});
