import { PostHog } from 'posthog-node';
import { ENV_VARS } from '@app/environment/environment.config';
import { IS_PRODUCTION_ENV } from '@app/environment/environment.utils.api';
import type { ReportIssueProps } from './error-debugger.types';
import {
  isEmailKey,
  redactEmailValue,
  redactEmailsInText,
} from './pii-redaction';

// Server-side error tracking through PostHog (ALONGSIDE the existing EventLog, which stays the SSOT
// of backend logs; PostHog adds alerting + stacktrace aggregation). Single hook point:
// reportIssueBackend (error-handler.ts). Guarded prod-only + key-present, so in dev or without a
// key the whole pipeline is a no-op (zero overhead, zero quota).
//
// Host = the DIRECT EU ingest (not the /ingest reverse proxy, which is a Next rewrite for the
// browser only). flushAt:1 / flushInterval:0 = send at once (errors are rare, and critical ones
// must arrive even if the process is killed by a redeploy right after).

const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com';

// Constant distinctId for server events without a user context: avoids creating thousands of
// anonymous person profiles (Error Tracking groups by exception fingerprint, not by person).
const BACKEND_DISTINCT_ID = 'backend';

let client: PostHog | null = null;

export function getPostHogServer(): PostHog | null {
  if (!IS_PRODUCTION_ENV()) {
    return null;
  }
  const key = ENV_VARS.POSTHOG_PROJECT_KEY;
  if (!key) {
    return null;
  }
  if (!client) {
    client = new PostHog(key, {
      host: ENV_VARS.POSTHOG_HOST || DEFAULT_POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return client;
}

/**
 * Bounded flush of the PostHog queue, to be called BEFORE `process.exit()`. Without it the
 * `$exception` event from the crash path (uncaughtException -> exit(1)) never leaves the process
 * (captureException enqueues an async POST; exit() does not drain I/O). The timeout keeps the
 * flush itself from hanging shutdown. Never-throw.
 */
export async function flushPostHogServer(timeoutMs = 2000): Promise<void> {
  const posthog = getPostHogServer();
  if (!posthog) {
    return;
  }
  try {
    await Promise.race([
      posthog.flush(),
      new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
    ]);
  } catch {
    // best-effort
  }
}

// DECISION: scrub is KEY-based and single-level (like SENSITIVE_KEY_REGEX in error-handler.ts). It does
// NOT scan the CONTENT of Error.message/.stack for embedded secrets (e.g. DATABASE_URL credentials in a
// Prisma error). That is a deliberate, bounded scope, identical to EventLog, which also lets an
// Error through untouched (error-handler.ts `if (input instanceof Error) return input`); a content
// scrub of all strings goes beyond that reference. If a real vector appears (e.g. a prod Prisma error
// with credentials), add a content regex HERE (one seam), not at call sites.
//
// Keys that may carry a secret are redacted in properties (defense-in-depth; the payload is already
// scrubbed in reportIssueBackend before EventLog, but the PostHog channel is a separate data path
// and is scrubbed independently). Mirrors SENSITIVE_KEY_REGEX from error-handler.
const SECRET_KEY_PATTERN =
  /(authorization|cookie|x-internal-secret|stripe-signature|api[_-]?key|access[_-]?token|refresh[_-]?token|token|sig|signature|password|secret|bearer|dsn)/i;

function scrub(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      out[key] = '[REDACTED]';
    } else if (isEmailKey(key)) {
      out[key] = Array.isArray(value)
        ? value.map(redactEmailValue)
        : redactEmailValue(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

// Extracts a flat, single-level context from the reportIssueBackend payload into properties.
// Errors are handled separately (captureException extracts type/message/stacktrace itself), so only
// objects/primitives land here as additional context.
function payloadToProps(
  payload: ReportIssueProps['payload']
): Record<string, unknown> {
  if (payload === null || payload === undefined) {
    return {};
  }
  if (payload instanceof Error) {
    return {};
  }
  if (typeof payload === 'object') {
    return scrub(payload as Record<string, unknown>);
  }
  return { payload_value: String(payload) };
}

/**
 * Buduje realny Error do `captureException` z payloadu reportIssueBackend.
 *
 * DECISION: the central error funnels (request.middleware unhandled-catch, process
 * unhandledRejection/uncaughtException) pass the payload as a PLAIN OBJECT `{ error|message, stack }`,
 * not an Error instance. A naive `new Error(data.message)` would carry the stack of THIS function
 * (posthog-server), and PostHog Error Tracking groups `$exception` by stack, so the whole class of
 * unexpected exceptions would collapse into one issue with posthog-server frames, destroying the
 * feature's main value (aggregation by real throw site). So: an Error payload is used as is; an
 * object with a string `stack` is rebuilt as an Error with the original `stack` GRAFTED on (+ message
 * from `error`/`message`/`data.message`) so the fingerprint follows the real throw site; a
 * primitive/none falls back to `data.message`.
 */
function toCaptureError(data: ReportIssueProps): Error {
  if (data.payload instanceof Error) {
    return data.payload;
  }
  const record =
    typeof data.payload === 'object' && data.payload !== null
      ? (data.payload as Record<string, unknown>)
      : null;
  const originalMessage =
    record && typeof record.error === 'string'
      ? record.error
      : record && typeof record.message === 'string'
        ? record.message
        : null;
  // Treść wyjątku szła do PostHoga surowa, a komunikaty sklejają adres w zdanie
  // (`Invalid email address: "…"`). Scrub dotykał wyłącznie properties, więc adres
  // trafiał do zewnętrznego subprocesora mimo redakcji obok.
  const error = new Error(
    redactEmailsInText(originalMessage || data.message || 'Backend error')
  );
  if (record && typeof record.stack === 'string' && record.stack.length > 0) {
    error.stack = record.stack;
  }
  return error;
}

/**
 * Bridge from reportIssueBackend to PostHog. Called for EVERY backend log, but only error + warn
 * pass through (info stays in EventLog):
 *   - 'error' -> captureException -> `$exception` event (drives the e-mail alert).
 *   - 'warn'  -> capture('backend_warning', severity:'warning') -> a SEPARATE event so it does NOT
 *     count towards the `$exception` alert threshold (startup/seeding warns are normal on every
 *     cold start and would flood the alert). Visible in the dashboard, optional second alert.
 *
 * Non-blocking and never-throw: reporting must not take down the caller (logger hot path).
 */
export function captureBackendIssue(data: ReportIssueProps): void {
  if (data.mode !== 'error' && data.mode !== 'warn') {
    return;
  }

  // getPostHogServer() lazily constructs the client on first call — keep it INSIDE
  // the try so a constructor throw can never escape this never-throw last line of
  // defense (reportIssueBackend calls us as its final step; a leak here would
  // propagate into every caller's error path).
  try {
    const posthog = getPostHogServer();
    if (!posthog) {
      return;
    }

    const baseProps = scrub({
      namespace: data.namespace,
      severity: data.mode === 'warn' ? 'warning' : 'error',
      ...payloadToProps(data.payload),
    });

    if (data.mode === 'error') {
      void posthog.captureException(
        toCaptureError(data),
        BACKEND_DISTINCT_ID,
        baseProps
      );
    } else {
      const warnProps: Record<string, unknown> = { ...baseProps };
      if (data.payload instanceof Error) {
        warnProps.error_message = data.payload.message;
        warnProps.error_stack = data.payload.stack ?? null;
      }
      void posthog.capture({
        distinctId: BACKEND_DISTINCT_ID,
        event: 'backend_warning',
        properties: {
          message: redactEmailsInText(data.message),
          ...warnProps,
        },
      });
    }
  } catch {
    // Reporting best-effort — nigdy nie przerywa loggera.
  }
}

// DECISION: distinctId = userId (Better Auth user.id), NOT BACKEND_DISTINCT_ID. This is a
// deliberately different contract from error/warn (captureBackendIssue): BUSINESS (funnel) events
// must land in the person profile of the specific person, to join the front's events (trial_started
// -> trial_converted -> cancel). The canonical person key across the system is user.id:
// session.userId (endpoints) and account.created_by_user_id (Stripe webhooks) are the same Better
// Auth value. The front already identifies: `usePostHogIdentify` (mounted by
// `PostHogIdentifyBridge` in the auth provider) calls `posthog.identify(user.id, { role_id })` and
// `reset()` on logout; `person_profiles:'identified_only'` on the front only stops profile creation
// for anonymous traffic.
/**
 * Kanał eventów BIZNESOWYCH (user-scoped) — OSOBNY od captureBackendIssue (error/warn).
 * Ten sam klient + gate (IS_PRODUCTION_ENV() && POSTHOG_PROJECT_KEY) co reszta pliku:
 * w dev / bez klucza = no-op. Fire-and-forget, never-throw (best-effort). Properties
 * scrubowane tym samym SECRET_KEY_PATTERN (defense-in-depth, spójnie z error/warn).
 */
export function captureBackendEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>
): void {
  try {
    const posthog = getPostHogServer();
    if (!posthog) {
      return;
    }
    void posthog.capture({
      distinctId,
      event,
      properties: properties ? scrub(properties) : {},
    });
  } catch {
    // best-effort — nigdy nie przerywa callera (side-effect biznesowy).
  }
}
