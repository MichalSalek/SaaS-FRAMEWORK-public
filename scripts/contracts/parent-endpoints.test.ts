import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findContractResponseViolation } from '../../.shared-kernel/application/contracts/contract-response';
import { APPLICATION_CONTRACTS } from '../../.shared-kernel/domain/application/application.contracts';
import { EMAIL_CONTRACTS } from '../../.shared-kernel/domain/email/email.contracts';
import { EVENT_LOG_CONTRACTS } from '../../.shared-kernel/domain/event-log/event-log.contracts';
import {
  CANCEL_EMAIL_SCHEDULE,
  TRIAL_EMAIL_SCHEDULE,
} from '../../.shared-kernel/domain/email/email-schedule.config';
import {
  FREE_EMAIL_CONFIG,
  FREE_EMAIL_RULES,
} from '../../.shared-kernel/domain/email/email-free.config';
import { NEWSLETTER_CONTRACTS } from '../../.shared-kernel/domain/newsletter/newsletter.contracts';
import { PRICING_CONTRACTS } from '../../.shared-kernel/domain/pricing/pricing.contracts';
import { PUBLIC_CONTRACTS } from '../../.shared-kernel/domain/public/public.contracts';

const ok = (
  contract: Parameters<typeof findContractResponseViolation>[0],
  event: string,
  data: unknown
): void => {
  const violation = findContractResponseViolation(contract, 200, {
    event,
    data,
  });
  assert.equal(violation, null, violation ?? '');
};

test('the live email schedule parses as the contract response', () => {
  ok(EMAIL_CONTRACTS.EMAIL_GET_SCHEDULE, 'EMAIL_SCHEDULE_FETCHED', {
    schedule: TRIAL_EMAIL_SCHEDULE,
    cancelSchedule: CANCEL_EMAIL_SCHEDULE,
    freeSchedule: { config: FREE_EMAIL_CONFIG, rules: FREE_EMAIL_RULES },
  });
});

test('pricing, runtime config, announcements and a public card parse', () => {
  ok(PRICING_CONTRACTS.PRICING_GET_PLANS, 'PRICING_PLANS_FETCHED', {
    plans: [
      { plan_id: 'FREE', monthly_price: 0, yearly_monthly_price: 0 },
      { plan_id: 'PRO', monthly_price: null, yearly_monthly_price: null },
    ],
    currency: 'pln',
    is_fallback: false,
    fetched_at: '2026-10-23T00:00:00.000Z',
  });
  ok(
    APPLICATION_CONTRACTS.GET_RUNTIME_CONFIG_PUBLIC,
    'PUBLIC_RUNTIME_CONFIG_FETCHED',
    {
      maintenanceMessage: '',
      maintenanceMode: false,
      verboseLogMode: false,
    }
  );
  ok(
    APPLICATION_CONTRACTS.ANNOUNCEMENTS_GET_ACTIVE,
    'ACTIVE_ANNOUNCEMENTS_FETCHED',
    [
      {
        id: 'a',
        title: 't',
        message: 'm',
        type: 'info',
        translations: { pl: { title: 't', message: 'm' } },
        audience_anonymous: true,
        audience_client: true,
        audience_stylist: true,
      },
    ]
  );
  ok(
    PUBLIC_CONTRACTS.GET_PUBLIC_STYLISTS_LIST,
    'PUBLIC_STYLISTS_LIST_FETCHED',
    {
      stylists: [],
      nextCursor: null,
    }
  );
});

test('contact success is an empty body and newsletter subscribe is the pending flag', () => {
  ok(PUBLIC_CONTRACTS.CONTACT_FORM_SUBMIT, 'CONTACT_FORM_SUBMITTED', undefined);
  ok(
    NEWSLETTER_CONTRACTS.NEWSLETTER_SUBSCRIBE,
    'NEWSLETTER_PENDING_CONFIRMATION',
    {
      subscribed: true,
      pending_confirmation: true,
    }
  );
});

test('event log page accepts a Date that the wire turns into a string', () => {
  ok(EVENT_LOG_CONTRACTS.EVENT_LOG_GET_ALL, 'SUCCESS', {
    records: [
      {
        event_log_id: '1',
        event: 'SUCCESS',
        event_type: 'INFO',
        created_at: new Date('2026-10-23T00:00:00.000Z'),
      },
    ],
    nextCursor: null,
  });
});

test('pricing and contact stay public without a grant', () => {
  assert.equal(PRICING_CONTRACTS.PRICING_GET_PLANS.access, 'PUBLIC_NO_GRANT');
  assert.equal(PRICING_CONTRACTS.PRICING_GET_PLANS.authCheck, false);
  assert.equal(PUBLIC_CONTRACTS.CONTACT_FORM_SUBMIT.access, 'PUBLIC_NO_GRANT');
  assert.equal(PUBLIC_CONTRACTS.CONTACT_FORM_SUBMIT.authCheck, false);
  assert.equal(PUBLIC_CONTRACTS.GET_PUBLIC_STYLISTS_LIST.access, 'PUBLIC');
  assert.equal(PUBLIC_CONTRACTS.GET_PUBLIC_STYLISTS_LIST.authCheck, true);
});
