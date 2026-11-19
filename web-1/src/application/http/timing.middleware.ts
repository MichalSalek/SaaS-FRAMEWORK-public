import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { debuggerStates } from '@app/debugger/debugger.state';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { generateRandomID } from '@app/utils/id.utils';
import { MIN_DURATION_TO_REPORT_AS_ISSUE } from '@app/debugger/debugger.config';
import { recordRequestTiming } from '@app/health/request-timing.buffer';
import type { RequestContext } from './request-context';
import { runWithRequestContext } from './request-context';
import { sanitizeObservationUrl } from './observation-url';

/**
 * DECISION: `x-request-id` comes from an UNAUTHENTICATED client and is echoed in a header and
 * stored as `event_log_chain_id`, so raw acceptance allowed poisoning the correlation chain
 * (planting a crafted id, deliberately colliding with someone else's, or injecting kilobytes /
 * control characters into logs). A value is accepted ONLY when it looks like our own id (the
 * UUID from `generateRandomID` fits the pattern); anything else is silently replaced with a fresh
 * id. Correlation is telemetry, not an API contract, so the request is not rejected with 400.
 */
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

const resolveCorrelationId = (req: NextApiRequest): string => {
  const raw = req.headers[CUSTOM_HEADERS['xRequestId']];
  const fromHeader = Array.isArray(raw) ? raw[0] : raw;
  return fromHeader !== undefined && CORRELATION_ID_PATTERN.test(fromHeader)
    ? fromHeader
    : generateRandomID();
};

const resolveRequestTarget = (req: NextApiRequest): string => {
  const method = req.method ?? 'UNKNOWN';
  const path =
    typeof req.url === 'string' ? sanitizeObservationUrl(req.url) : '';
  return path ? `${method} ${path}` : method;
};

const resolveReferer = (req: NextApiRequest): string | null => {
  const raw = req.headers.referer;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  return sanitizeObservationUrl(value).slice(0, 300);
};

const buildRequestContext = (
  req: NextApiRequest,
  correlationId: string
): RequestContext => ({
  correlationId,
  startedAtMs: Date.now(),
  requestTarget: resolveRequestTarget(req),
  referer: resolveReferer(req),
  userId: null,
});

/**
 * Timing middleware - measures request duration and logs slow requests (>30ms).
 * Always records request timing to the health buffer for the health dashboard.
 * Verbose logging is gated by the runtime `debuggerStates.isEnabledApiTimingDebugger`
 * toggle (admin panel → DB, loaded on boot and updated event-driven in the
 * current process), not by any env var.
 *
 * Also enters the per-request AsyncLocalStorage context (request-context.ts)
 * so that every downstream `reportIssueBackend()` call — including those
 * scheduled via `runAfterResponse()` cleanup interceptors — automatically
 * inherits the same correlationId without explicit pass-through.
 */
export const withTimingNextHandlerMiddleware = (
  handler: NextApiHandler
): NextApiHandler => {
  // DECISION: isEnabledApiTimingDebugger is checked per request, not at middleware construction,
  // so the runtime toggle (admin panel, no deploy) takes effect immediately; the flag is mutated
  // by the admin update operation in this process.
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const start = process.hrtime.bigint();
    const correlationId = resolveCorrelationId(req);
    res.setHeader(CUSTOM_HEADERS['xRequestId'], correlationId);

    if (!debuggerStates.isEnabledApiTimingDebugger) {
      // DECISION: the fast path (metrics debugger off, the production default) also listens to
      // `close`. A request aborted by the client (closed tab, mobile timeout) never emits `finish`,
      // so it never reached the health-dashboard buffer; the longest requests are the ones that
      // break off, so the stats cut off their own tail and looked faster than reality. Double
      // counting is excluded by the same `concluded` gate as the full path: `close` fires after
      // `finish` on every normal response.
      let concluded = false;
      const conclude = (): void => {
        if (concluded) {
          return;
        }
        concluded = true;
        const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
        recordRequestTiming(Math.round(durationMs));
      };
      res.once('finish', conclude);
      res.once('close', conclude);

      return runWithRequestContext(
        buildRequestContext(req, correlationId),
        () => handler(req, res)
      );
    }

    let concluded = false;
    const conclude = (reason: 'finish' | 'close' = 'finish') => {
      if (concluded) {
        return;
      }
      concluded = true;

      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;

      // Always record timing for health dashboard
      recordRequestTiming(Math.round(durationMs));

      // Only log if duration exceeds threshold
      if (durationMs < MIN_DURATION_TO_REPORT_AS_ISSUE) {
        return void undefined;
      }

      reportIssueBackend({
        namespace: APP_EVENTS.INFO.APPLICATION.API_REQUEST_TIMING,
        mode: 'info',
        // Bez query stringa: ten sam powod, dla ktorego ma go `requestTarget`.
        // W adresach tego API siedza JEDNORAZOWE SEKRETY (`newsletter-confirm`,
        // `email/unsubscribe`, `user/delete/confirm`, `confirm-email-change`),
        // a pomiar czasu nigdy ich nie potrzebowal.
        message: `${resolveRequestTarget(req)} duration:"${Math.round(durationMs)}"ms because of ${reason}`,
        event_log_chain_id: correlationId,
        payload: {
          eventName: APP_EVENTS.INFO.APPLICATION.API_REQUEST_TIMING,
          responseBody: {
            method: req.method,
            url:
              typeof req.url === 'string'
                ? sanitizeObservationUrl(req.url)
                : req.url,
            statusCode: res.statusCode,
            duration: Math.round(durationMs),
            reason,
          },
        },
      });
    };

    res.once('finish', () => conclude('finish'));
    res.once('close', () => conclude('close'));

    return runWithRequestContext(buildRequestContext(req, correlationId), () =>
      handler(req, res)
    );
  };
};
