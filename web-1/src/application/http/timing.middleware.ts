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

/**
 * DECISION (nie usuwaj tego komentarza):
 * `x-request-id` przychodzi od NIEUWIERZYTELNIONEGO klienta, a my odsyłamy go w nagłówku
 * i zapisujemy jako `event_log_chain_id` — surowa akceptacja pozwalała zatruć łańcuch
 * korelacji: podrzucić spreparowany id, celowo zderzyć się z cudzym (zaśmiecenie śledztwa)
 * albo wpompować kilobajty / znaki sterujące do logów. Przyjmujemy wartość TYLKO gdy
 * wygląda jak nasz własny identyfikator (UUID z `generateRandomID` mieści się w tym
 * wzorcu); cokolwiek innego cicho zastępujemy świeżym id — korelacja to telemetria,
 * nie kontrakt API, więc nie odrzucamy requestu 400.
 */
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

const resolveCorrelationId = (req: NextApiRequest): string => {
  const raw = req.headers[CUSTOM_HEADERS['xRequestId']];
  const fromHeader = Array.isArray(raw) ? raw[0] : raw;
  return fromHeader !== undefined && CORRELATION_ID_PATTERN.test(fromHeader)
    ? fromHeader
    : generateRandomID();
};

/** Ścieżka bez query — patrz DECISION przy `RequestContext.requestTarget`. */
const stripQuery = (url: string): string => {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
};

const resolveRequestTarget = (req: NextApiRequest): string => {
  const method = req.method ?? 'UNKNOWN';
  const path = typeof req.url === 'string' ? stripQuery(req.url) : '';
  return path ? `${method} ${path}` : method;
};

const resolveReferer = (req: NextApiRequest): string | null => {
  const raw = req.headers.referer;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  return stripQuery(value).slice(0, 300);
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
  // DECISION (nie usuwaj tego komentarza):
  // isEnabledApiTimingDebugger is checked per-request (not at middleware construction time)
  // so that the runtime config toggle (admin panel → no deploy) takes effect immediately.
  // The flag is mutated by the admin update operation in this process.
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const start = process.hrtime.bigint();
    const correlationId = resolveCorrelationId(req);
    res.setHeader(CUSTOM_HEADERS['xRequestId'], correlationId);

    if (!debuggerStates.isEnabledApiTimingDebugger) {
      // DECISION (nie usuwaj tego komentarza) — TA ŚCIEŻKA TEŻ SŁUCHA `close`:
      // szybka ścieżka (debugger metryk wyłączony, czyli DOMYŚLNIE na produkcji)
      // rejestrowała wyłącznie `finish`. Request zerwany przez klienta — abort,
      // zamknięta karta, timeout mobilnej sieci — nigdy nie emituje `finish`, więc
      // NIE trafiał do bufora health-dashboardu w ogóle. Efekt jest gorszy niż brak
      // danych: zrywają się najdłuższe requesty, więc statystyka wycinała sobie
      // własny ogon i tym mocniej pokazywała „szybko", im gorzej realnie było.
      // Podwójne liczenie jest wykluczone tą samą bramką `concluded`, co na ścieżce
      // pełnej: `close` leci po `finish` na każdej normalnej odpowiedzi, więc bez
      // strażnika ta zmiana dublowałaby KAŻDY pomiar.
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
            url: typeof req.url === 'string' ? stripQuery(req.url) : req.url,
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
