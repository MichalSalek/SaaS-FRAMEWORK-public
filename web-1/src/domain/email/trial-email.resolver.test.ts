/**
 * resolveTrialEmails: PAID+TRIALING is the live trial audience, D30/D37 go
 * only to non-converters, and rules older than the catch-up window are skipped.
 */

import { describe, expect, it } from 'vitest';
import { TIME } from '@kernel/application/constants.config';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  PaymentStatusValue,
  SubscriptionStatusValue,
} from '@kernel/models/db_models.generated.dto';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import type { StylistAccountWithStats } from './email.types';
import { resolveTrialEmails } from './trial-email.resolver';

const DAY = TIME.MS_PER_DAY;
const START = new Date('2026-08-01T00:00:00.000Z');

const account = (
  overrides: Partial<StylistAccountWithStats> = {}
): StylistAccountWithStats => ({
  account_id: 'acc',
  trial_started_at: START,
  trial_ends_at: new Date(START.getTime() + 30 * DAY),
  payment_status: PaymentStatusValue.PAID,
  subscription_status: SubscriptionStatusValue.TRIALING,
  pricing_plan: PricingPlanValue.PRO,
  display_name: 'Ada',
  email_preferences: null,
  email_marketing: true,
  email_trial_sequence: true,
  created_by_user_id: 'user',
  created_by_user: { is_active: true, email: 'a@b.c', name: 'Ada' },
  _count: { gallery_record: 0 },
  stylist_pairings_count: 0,
  ...overrides,
});

const ids = (rules: readonly { id: string }[]): string[] =>
  rules.map(rule => rule.id);

const none = new Set<EVENT_INFO_TYPE>();

describe('resolveTrialEmails', () => {
  it('sends in-trial nudges to a PAID trialing account', () => {
    const now = new Date(START.getTime() + 23 * DAY);
    expect(ids(resolveTrialEmails(account(), none, null, now))).toEqual([
      'TRIAL_D23_WARNING',
    ]);
  });

  it('does not dump stale early nudges onto a mid-trial account', () => {
    const now = new Date(START.getTime() + 15 * DAY);
    expect(ids(resolveTrialEmails(account(), none, null, now))).toEqual([
      'TRIAL_D14_INACTIVE',
    ]);
  });

  it('sends D1 and D3 together when both sit inside the catch-up window', () => {
    const now = new Date(START.getTime() + 3 * DAY);
    expect(ids(resolveTrialEmails(account(), none, null, now))).toEqual([
      'TRIAL_D1_NUDGE',
      'TRIAL_D3_INACTIVE',
    ]);
  });

  it('skips in-trial nudges for PAST_DUE and CANCELED', () => {
    const now = new Date(START.getTime() + DAY);
    expect(
      resolveTrialEmails(
        account({
          subscription_status: SubscriptionStatusValue.PAST_DUE,
          payment_status: PaymentStatusValue.IN_PROGRESS,
        }),
        none,
        null,
        now
      )
    ).toEqual([]);
    expect(
      resolveTrialEmails(
        account({
          subscription_status: SubscriptionStatusValue.CANCELED,
          payment_status: PaymentStatusValue.UNPAID,
          pricing_plan: PricingPlanValue.FREE,
        }),
        none,
        null,
        now
      )
    ).toEqual([]);
  });

  it('sends D30 only when the trial ended and the account is on Free', () => {
    const now = new Date(START.getTime() + 30 * DAY + 60 * 60 * 1000);
    const ended = account({
      trial_ends_at: new Date(START.getTime() + 30 * DAY),
    });
    expect(
      resolveTrialEmails(
        account({
          ...ended,
          subscription_status: SubscriptionStatusValue.ACTIVE,
          payment_status: PaymentStatusValue.PAID,
          pricing_plan: PricingPlanValue.PRO,
        }),
        none,
        null,
        now
      )
    ).toEqual([]);
    expect(
      ids(
        resolveTrialEmails(
          account({
            ...ended,
            subscription_status: SubscriptionStatusValue.CANCELED,
            payment_status: PaymentStatusValue.UNPAID,
            pricing_plan: PricingPlanValue.FREE,
          }),
          none,
          null,
          now
        )
      )
    ).toEqual(['TRIAL_D30_ENDED']);
    expect(
      ids(
        resolveTrialEmails(
          account({
            ...ended,
            subscription_status: SubscriptionStatusValue.PAST_DUE,
            payment_status: PaymentStatusValue.IN_PROGRESS,
            pricing_plan: PricingPlanValue.PRO,
          }),
          none,
          null,
          now
        )
      )
    ).toEqual([]);
  });

  it('keeps the renewal promise (D23, D29) away from a trial canceled mid-way', () => {
    const canceling = account({ cancel_at_period_end: true });
    const day23 = new Date(START.getTime() + 23 * DAY);
    const day29 = new Date(START.getTime() + 29 * DAY);
    expect(resolveTrialEmails(canceling, none, null, day23)).toEqual([]);
    expect(resolveTrialEmails(canceling, none, null, day29)).toEqual([]);
    const day14 = new Date(START.getTime() + 14 * DAY);
    expect(ids(resolveTrialEmails(canceling, none, null, day14))).toEqual([
      'TRIAL_D14_INACTIVE',
    ]);
  });

  it('does not send D30 while Stripe still says TRIALING after the clock', () => {
    const now = new Date(START.getTime() + 30 * DAY + 60 * 60 * 1000);
    expect(
      resolveTrialEmails(
        account({
          trial_ends_at: new Date(START.getTime() + 30 * DAY),
          subscription_status: SubscriptionStatusValue.TRIALING,
          payment_status: PaymentStatusValue.PAID,
          pricing_plan: PricingPlanValue.PRO,
        }),
        none,
        null,
        now
      )
    ).toEqual([]);
  });

  it('skips D37 when marketing is off, and skips a stale D30', () => {
    const day37 = new Date(START.getTime() + 37 * DAY);
    const lapsed = account({
      trial_ends_at: new Date(START.getTime() + 30 * DAY),
      subscription_status: SubscriptionStatusValue.CANCELED,
      payment_status: PaymentStatusValue.UNPAID,
      pricing_plan: PricingPlanValue.FREE,
      email_marketing: false,
    });
    expect(
      resolveTrialEmails(
        lapsed,
        none,
        { trial_sequence: true, marketing: false },
        day37
      )
    ).toEqual([]);
    expect(
      ids(
        resolveTrialEmails(
          account({ ...lapsed, email_marketing: true }),
          none,
          { trial_sequence: true, marketing: true },
          day37
        )
      )
    ).toEqual(['TRIAL_D37_WINBACK']);
    const day33 = new Date(START.getTime() + 33 * DAY);
    expect(
      resolveTrialEmails(
        account({ ...lapsed, email_marketing: true }),
        none,
        null,
        day33
      )
    ).toEqual([]);
  });

  it('returns nothing without a trial start or for an inactive user', () => {
    const now = new Date(START.getTime() + DAY);
    expect(
      resolveTrialEmails(account({ trial_started_at: null }), none, null, now)
    ).toEqual([]);
    expect(
      resolveTrialEmails(
        account({
          created_by_user: { is_active: false, email: 'a@b.c', name: 'Ada' },
        }),
        none,
        null,
        now
      )
    ).toEqual([]);
  });

  it('does not re-send a rule already in EventLog', () => {
    const now = new Date(START.getTime() + DAY);
    const sent = new Set<EVENT_INFO_TYPE>(['EMAIL_WELCOME_SENT']);
    expect(ids(resolveTrialEmails(account(), sent, null, now))).toEqual([
      'TRIAL_D1_NUDGE',
    ]);
  });
});
