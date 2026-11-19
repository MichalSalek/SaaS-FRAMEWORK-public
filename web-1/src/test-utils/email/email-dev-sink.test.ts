/**
 * Unit tests — dev email sink (Mailgun daily-quota guard).
 *
 * Verifies: production never stubs; dev lets the first N canary Mailgun sends
 * through then stubs the rest; SMTP is always stubbed in dev; DEV_EMAIL_FORCE_LIVE
 * bypasses stubbing; budget is configurable (incl. 0 = stub everything).
 *
 * `IS_DEVELOPMENT_ENV` and `ENV_VARS` are mocked via hoisted holders so each test
 * controls the mode + flags without touching real process env.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  isDev: { value: true },
  envVars: {
    DEV_EMAIL_LIVE_BUDGET: '' as string,
    DEV_EMAIL_FORCE_LIVE: false as boolean,
  },
}));

vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: () => undefined,
}));
vi.mock('@app/environment/environment.config', () => ({
  ENV_VARS: h.envVars,
}));
vi.mock('@app/environment/environment.utils.api', () => ({
  IS_DEVELOPMENT_ENV: () => h.isDev.value,
}));

import {
  shouldStubEmailSend,
  __resetEmailDevSinkForTest,
} from '@app/email-handler/email-dev-sink';

const mailgun = (n = 1) =>
  shouldStubEmailSend({
    to: `u${n}@example.com`,
    subject: 's',
    transport: 'mailgun',
  });
const smtp = () =>
  shouldStubEmailSend({ to: 'u@example.com', subject: 's', transport: 'smtp' });

describe('email-dev-sink — shouldStubEmailSend', () => {
  beforeEach(() => {
    h.isDev.value = true;
    h.envVars.DEV_EMAIL_LIVE_BUDGET = '';
    h.envVars.DEV_EMAIL_FORCE_LIVE = false;
    __resetEmailDevSinkForTest();
  });

  it('NEVER stubs in production (mailgun + smtp both real)', () => {
    h.isDev.value = false;
    for (let i = 0; i < 5; i++) {
      expect(mailgun(i)).toBe(false);
    }
    expect(smtp()).toBe(false);
  });

  it('dev default budget=1: first Mailgun send is the canary (real), rest stubbed', () => {
    expect(mailgun(1)).toBe(false); // canary — delivered for real
    expect(mailgun(2)).toBe(true); // stubbed
    expect(mailgun(3)).toBe(true); // stubbed
  });

  it('dev ALWAYS stubs the SMTP fallback (same Mailgun quota)', () => {
    expect(smtp()).toBe(true);
    expect(smtp()).toBe(true);
  });

  it('DEV_EMAIL_FORCE_LIVE=true bypasses stubbing entirely', () => {
    h.envVars.DEV_EMAIL_FORCE_LIVE = true;
    expect(mailgun(1)).toBe(false);
    expect(mailgun(2)).toBe(false);
    expect(smtp()).toBe(false);
  });

  it('budget=0 stubs every Mailgun send (no canary)', () => {
    h.envVars.DEV_EMAIL_LIVE_BUDGET = '0';
    expect(mailgun(1)).toBe(true);
    expect(mailgun(2)).toBe(true);
  });

  it('budget=3 lets the first three Mailgun sends through, then stubs', () => {
    h.envVars.DEV_EMAIL_LIVE_BUDGET = '3';
    expect(mailgun(1)).toBe(false);
    expect(mailgun(2)).toBe(false);
    expect(mailgun(3)).toBe(false);
    expect(mailgun(4)).toBe(true);
  });

  it('malformed budget falls back to the safe default of 1', () => {
    h.envVars.DEV_EMAIL_LIVE_BUDGET = 'abc';
    expect(mailgun(1)).toBe(false); // canary
    expect(mailgun(2)).toBe(true); // stubbed
  });
});
