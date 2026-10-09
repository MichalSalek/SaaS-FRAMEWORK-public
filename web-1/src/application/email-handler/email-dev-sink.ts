/**
 * Dev Email Sink — Mailgun daily-quota guard for local/dev runs.
 *
 * PROBLEM: the startup smoke suite fires real transactional emails on EVERY
 * container restart (dev iterates → many restarts/day), and Mailgun caps
 * REQUESTS (not deliveries) per day. One day of dev debugging can
 * exhaust the whole quota, after which even production-like smoke checks fail.
 *
 * BEHAVIOUR (development only — production NEVER stubs):
 *   - The first `DEV_EMAIL_LIVE_BUDGET` (default 1) Mailgun sends per process go
 *     out for real — a CANARY that proves Mailgun creds/domain still work on boot.
 *   - Every further send is STUBBED: logged with its payload, resolved as success,
 *     never delivered. Zero further quota burned.
 *   - The SMTP fallback is ALWAYS stubbed in dev — it shares the same capped
 *     Mailgun account, and dev does not need to exercise the fallback transport.
 *   - `DEV_EMAIL_FORCE_LIVE=true` bypasses all stubbing (real sends in dev) for the
 *     rare case of genuinely debugging email delivery locally.
 *
 * DECISION (nie usuwaj tego komentarza):
 * The budget counts ATTEMPTS, not successes, and is per-process (resets on each
 * restart). Rationale: when Mailgun is healthy the first attempt succeeds and the
 * canary has proven the pipe; when Mailgun is down/capped no number of attempts
 * would succeed anyway, so "1 attempt then stub" still correctly avoids the storm.
 * Per-process reset means each boot re-verifies Mailgun exactly once — matching the
 * intent "let one email through to test Mailgun, stub the rest".
 *
 * This is a DEV-ONLY chokepoint at the transport adapters; the circuit breakers,
 * retry, dedup, dead-letter and audit layers above it are unaffected and run their
 * full real logic against the stubbed (successful) transport result.
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

  // SMTP fallback shares the capped Mailgun account and is not under test in dev.
  // Resend też zawsze stub w dev (jak SMTP): ma osobny dzienny limit i NIE testujemy
  // go lokalnie (RESEND_ENABLED domyślnie OFF w dev). KRYTYCZNE (spar): wspólny licznik
  // canary nie może zostać skonsumowany przez Resend i wystubować realnego canary
  // Mailguna — wtedy fallback "udałby sukces" bez dostarczenia (ukryty broken login w dev).
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
