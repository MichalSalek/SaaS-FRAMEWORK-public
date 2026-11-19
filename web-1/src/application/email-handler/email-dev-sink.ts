/**
 * Dev-only Mailgun quota guard. Production never stubs. The first
 * `DEV_EMAIL_LIVE_BUDGET` sends per process (default 1) go out as a canary; further
 * sends, and every SMTP fallback, are logged and resolved as success.
 * `DEV_EMAIL_FORCE_LIVE=true` skips the stub.
 * DECISION: the budget counts attempts, per process. When Mailgun is down, one attempt
 * then a stub still stops the restart storm. Breakers above still run against the stub.
 */

import { ENV_VARS } from '@app/environment/environment.config';
import { IS_DEVELOPMENT_ENV } from '@app/environment/environment.utils.api';
import { reportIssueBackend } from '@app/debugger/error-handler';

/** Default real-send budget per process when DEV_EMAIL_LIVE_BUDGET is unset. */
const DEFAULT_LIVE_BUDGET = 1;

/** Real Mailgun sends performed so far this process (dev only). */
let _liveSendsUsed = 0;

const resolveLiveBudget = (): number => {
  const raw = ENV_VARS.DEV_EMAIL_LIVE_BUDGET;
  if (!raw) {
    return DEFAULT_LIVE_BUDGET;
  }
  const parsed = Number.parseInt(raw, 10);
  // Clamp to >= 0; a malformed value falls back to the safe default.
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_LIVE_BUDGET;
};

export type EmailSinkTransport = 'mailgun' | 'smtp' | 'resend';

type StubDecisionMeta = {
  to: string;
  subject: string;
  transport: EmailSinkTransport;
};

/**
 * Decide whether THIS send should be stubbed (skipped) instead of really sent.
 *
 * @returns true  → caller MUST skip the real send and resolve as success.
 *          false → caller proceeds with the real network send.
 */
export const shouldStubEmailSend = (meta: StubDecisionMeta): boolean => {
  // Production (and STAGING/unknown) always send for real — never stub.
  if (!IS_DEVELOPMENT_ENV()) {
    return false;
  }

  // Explicit dev override: real sends everywhere (debugging email locally).
  if (ENV_VARS.DEV_EMAIL_FORCE_LIVE) {
    return false;
  }

  if (meta.transport === 'smtp' || meta.transport === 'resend') {
    logStub(meta);
    return true;
  }

  // Mailgun canary: let the first N attempts through to verify the pipe on boot.
  if (_liveSendsUsed < resolveLiveBudget()) {
    _liveSendsUsed += 1;
    reportIssueBackend({
      namespace: 'DEV_EMAIL_LIVE_CANARY',
      message: `[dev] Mailgun canary send ${_liveSendsUsed}/${resolveLiveBudget()} — delivering for real to verify Mailgun connectivity.`,
      payload: { to: meta.to, subject: meta.subject },
      mode: 'info',
    });
    return false;
  }

  logStub(meta);
  return true;
};

const logStub = (meta: StubDecisionMeta): void => {
  reportIssueBackend({
    namespace: 'DEV_EMAIL_STUBBED',
    message: `[dev] Email STUBBED (not delivered) to preserve the Mailgun daily quota. Transport: ${meta.transport}. Set DEV_EMAIL_FORCE_LIVE=true to send for real.`,
    payload: { to: meta.to, subject: meta.subject, transport: meta.transport },
    mode: 'info',
  });
};

/** Test-only: reset the per-process canary counter between cases. */
export const __resetEmailDevSinkForTest = (): void => {
  _liveSendsUsed = 0;
};
