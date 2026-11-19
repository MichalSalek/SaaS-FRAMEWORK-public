import { describe, expect, it } from 'vitest';
import type { AdminEmailPipelineSend } from '@kernel/models/admin/admin-mailing.dto';
import { mergePipelineQueue, readEmailsSent } from './email-pipeline.query';

const send = (
  userId: string,
  ruleId: string,
  due: AdminEmailPipelineSend['due']
): AdminEmailPipelineSend => ({
  userId,
  email: `${userId}@example.test`,
  ruleId,
  infoEvent: 'EMAIL_WELCOME_SENT',
  templateId: 'welcome',
  due,
});

describe('mergePipelineQueue', () => {
  it.each([
    'payment-failed',
    'dunning-info',
    'dunning-urgent',
    'dunning-final',
  ])('keeps recovery template %s when present in the queue', templateId => {
    const recovery = { ...send('u1', 'recovery', 'today'), templateId };
    expect(mergePipelineQueue([recovery], [])).toEqual([recovery]);
  });
  it('omits disabled billing warnings from the preview on both days', () => {
    const warning = {
      ...send('u1', 'D23', 'today'),
      templateId: 'trial-warning',
    };
    const renewal = {
      ...send('u2', 'renewal', 'tomorrow'),
      templateId: 'renewal-reminder',
    };
    expect(
      mergePipelineQueue([warning], [renewal, send('u3', 'D1', 'tomorrow')])
    ).toEqual([send('u3', 'D1', 'tomorrow')]);
  });
  it('lists a send due both days once, under today', () => {
    const merged = mergePipelineQueue(
      [send('u1', 'TRIAL_D1_NUDGE', 'today')],
      [
        send('u1', 'TRIAL_D1_NUDGE', 'tomorrow'),
        send('u2', 'ONBOARDING_INCOMPLETE_24H', 'tomorrow'),
      ]
    );
    expect(merged.map(s => `${s.userId}:${s.ruleId}:${s.due}`)).toEqual([
      'u1:TRIAL_D1_NUDGE:today',
      'u2:ONBOARDING_INCOMPLETE_24H:tomorrow',
    ]);
  });

  it('keeps a different rule for the same person on the next day', () => {
    const merged = mergePipelineQueue(
      [send('u1', 'TRIAL_D1_NUDGE', 'today')],
      [send('u1', 'TRIAL_D3_INACTIVE', 'tomorrow')]
    );
    expect(merged).toHaveLength(2);
  });
});

describe('readEmailsSent', () => {
  it('reads responseBody.emailsSent from the sweep audit row', () => {
    expect(readEmailsSent({ responseBody: { emailsSent: 3 } })).toBe(3);
  });

  it('returns null for anything else', () => {
    expect(readEmailsSent(null)).toBeNull();
    expect(readEmailsSent({ responseBody: null })).toBeNull();
    expect(readEmailsSent({ responseBody: { emailsSent: '3' } })).toBeNull();
  });
});
