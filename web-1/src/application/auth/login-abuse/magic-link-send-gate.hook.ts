import { APIError } from 'better-auth/api';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { MAGIC_LINK_GATE_CODES } from '@kernel/application/auth/auth.config';
import { reportIssueBackend } from '@app/debugger/error-handler';
import {
  isTurnstileEnabled,
  verifyTurnstileToken,
} from '@app/security/turnstile.verify';
import {
  createResilientThrottleCounterStore,
  type ThrottleCounterStore,
} from '@app/security/throttle-counter.store';
import { readStampedClientIp } from '../better-auth/client-ip-stamp';
import {
  evaluateMagicLinkSend,
  type MagicLinkSendDecision,
} from './magic-link-send-gate';

const MAGIC_LINK_SEND_PATH = '/sign-in/magic-link';

let store: ThrottleCounterStore | null = null;
const getStore = (): ThrottleCounterStore => {
  store ??= createResilientThrottleCounterStore();
  return store;
};

type GateContext = {
  path: string;
  body?: unknown;
  headers?: Headers | undefined;
  request?: Request | undefined;
};

const readEmail = (body: unknown): string | null => {
  if (typeof body !== 'object' || body === null || !('email' in body)) {
    return null;
  }
  const { email } = body;
  return typeof email === 'string' ? email : null;
};

const toApiError = (
  decision: Exclude<MagicLinkSendDecision, { kind: 'allow' }>
): APIError => {
  switch (decision.kind) {
    case 'rate-limited':
      return new APIError(
        'TOO_MANY_REQUESTS',
        {
          code: MAGIC_LINK_GATE_CODES.RATE_LIMITED,
          message:
            'Too many sign-in links to this address from this connection. Try again later.',
        },
        { 'Retry-After': String(decision.retryAfterSeconds) }
      );
    case 'turnstile-required':
      return new APIError('PRECONDITION_REQUIRED', {
        code: MAGIC_LINK_GATE_CODES.TURNSTILE_REQUIRED,
        message: 'Confirm the challenge and send again.',
      });
    case 'turnstile-invalid':
      return new APIError('PRECONDITION_REQUIRED', {
        code: MAGIC_LINK_GATE_CODES.TURNSTILE_INVALID,
        message: 'The challenge was not accepted. Try it again.',
      });
  }
};

/**
 * Better Auth `hooks.before` step for the magic-link SEND only (verify and OAuth untouched).
 * Throws an APIError to refuse; returns quietly to let the send go on.
 *
 * DECISION: an unexpected failure of the gate itself lets the send through and is reported. The
 * magic link is the main login path, Better Auth's per-IP limit still applies, and the counter
 * store already degrades to memory on a database outage; a bug here must not lock everyone out.
 */
export const enforceMagicLinkSendGate = async (
  ctx: GateContext,
  deps: { store?: ThrottleCounterStore } = {}
): Promise<void> => {
  if (ctx.path !== MAGIC_LINK_SEND_PATH) {
    return;
  }
  const email = readEmail(ctx.body);
  if (email === null) {
    return;
  }
  const headers = ctx.request?.headers ?? ctx.headers;
  const token = headers?.get(CUSTOM_HEADERS.turnstileToken)?.trim() ?? '';

  let decision: MagicLinkSendDecision;
  try {
    decision = await evaluateMagicLinkSend(
      {
        email,
        ip: readStampedClientIp(headers),
        turnstileToken: token.length > 0 ? token : null,
      },
      {
        store: deps.store ?? getStore(),
        turnstileEnabled: isTurnstileEnabled,
        verifyTurnstile: verifyTurnstileToken,
        now: () => new Date(),
      }
    );
  } catch (error) {
    reportIssueBackend({
      namespace: 'MAGIC_LINK_GATE',
      message: 'Magic-link send gate failed; the send was let through',
      payload: error,
      mode: 'error',
    });
    return;
  }

  if (decision.kind === 'allow') {
    if (decision.degraded) {
      reportIssueBackend({
        namespace: 'MAGIC_LINK_GATE',
        message:
          'Risky magic-link send allowed without Turnstile (not configured or unreachable)',
        payload: {},
        mode: 'warn',
      });
    }
    return;
  }
  throw toApiError(decision);
};
