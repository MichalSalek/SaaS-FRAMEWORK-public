import type { EventLogRecord } from '@kernel/models/db_models.manual.dto';
import {
  getEnvironmentMode,
  IS_DEVELOPMENT_ENV,
} from '@app/environment/environment.utils.api';
import { debuggerStates } from './debugger.state';
import { captureStackTrace, getClientURL } from './debugger.utils.api';
import type { ReportIssueProps } from './error-debugger.types';
import { createEventLogRecord_IO } from './error-handler-io';
import { shouldLogMessage } from './log-rate-limiter';
import {
  getCurrentCorrelationId,
  getCurrentRequestUserId,
} from '@app/http/request-context';
import { serializeErrorLike } from '@kernel/application/error-serialization';
import { captureBackendIssue } from './posthog-server';
import { redactEmailsInText } from './pii-redaction';
import { redactSensitive } from './diagnostic-sanitizer';

export const reportIssueBackend = (data: ReportIssueProps): void => {
  if (data.mode === 'info' && !debuggerStates.isEnabledDebugMode) {
    return;
  }

  if (!shouldLogMessage(data.namespace, data.message, data.mode)) {
    return;
  }

  const handledPayload = (): string => {
    if (data.payload instanceof Error) {
      console.error(data.payload);
    }

    switch (typeof data.payload) {
      case 'object':
      default:
        try {
          // DECISION: serializeErrorLike BEFORE redactSensitive; the order matters. `redactSensitive`
          // used to return Error instances untouched, so `JSON.stringify` dropped `message`/`stack`
          // (non-enumerable) and did NOT redact the error's own fields. After normalization the
          // error is a plain object: the message survives and the scrub covers its fields.
          return JSON.stringify(
            redactSensitive(serializeErrorLike(data.payload))
          );
        } catch {
          return '[Unserializable payload]';
        }
      case 'string':
        // Surowy tekst też bywa nośnikiem adresu (komunikat dostawcy przekazany
        // jako payload), a wcześniej wychodził stąd bez żadnego scrubu.
        return redactEmailsInText(data.payload);
      case 'number':
      case 'boolean':
        return String(data.payload);
      case 'undefined':
        return 'undefined';
    }
  };

  // DECISION: in production the stack is captured for mode==='error' (before: dev only, so EVERY
  // production error record had `{"callstack":[]}`). Without stack and message (see
  // serializeErrorLike) a log-store entry was not reproducible. Cost: one `new Error()` on the error
  // path; info/warn stay stackless because that is a high-volume channel, not a diagnostic one.
  const callstack = () => {
    if (IS_DEVELOPMENT_ENV() || data.mode === 'error') {
      return captureStackTrace();
    }
    return [];
  };

  // DECISION: event_log_chain_id resolution priority: 1) explicit `data.event_log_chain_id` (the
  // caller knows best, e.g. timing middleware passing its own correlationId); 2) the
  // AsyncLocalStorage frame set by timing.middleware.ts (request-context.ts), covering all
  // in-request callers; 3) the '0' sentinel for callers outside a request (startup, SIGTERM, cron
  // sweeps), matching the system-event marker used by writeRawEventLog_IO and frontend log ingestion.
  const resolvedChainId =
    data.event_log_chain_id ?? getCurrentCorrelationId() ?? '0';

  const input: Omit<EventLogRecord, 'id' | 'created_at'> = {
    environment: getEnvironmentMode(),
    type: data.mode,
    namespace: data.namespace,
    // `message` też przechodzi redakcję: komunikaty sklejają adres w zdanie, a to
    // pole szło do bazy nietknięte OBOK zredagowanego payloadu — czyli rekord
    // wygladal na czysty, bedac jedynym miejscem z pelnym adresem.
    message: redactEmailsInText(data.message),
    payload: handledPayload(),
    application: 'backend',
    event_log_chain_id: resolvedChainId,
    user_metadata: JSON.stringify({ callstack: callstack() }),
    client_url: getClientURL(),
    user_id: getCurrentRequestUserId() ?? null,
  };

  if (data.mode !== 'info' || debuggerStates.isEnabledDebugMode) {
    console[data.mode](input);
  }

  // DECISION: there is NO log-store health signal here, and none should be added. `createEventLogRecord_IO`
  // only appends to a buffer and returns (no DB write, no rejection path); a sensor attached to this
  // call could never fire `markLogSinkWriteFailed` while `markLogSinkWriteSucceeded` would fire on
  // every line and report "writes recovered" over a still-dead DB. The real write is `runFlush` in
  // `error-handler-io.ts`, where the sensor is wired.
  void createEventLogRecord_IO(input);

  // PostHog Error Tracking (ALONGSIDE EventLog: alerting + stacktrace aggregation). Same single
  // funnel as EventLog, so process handlers (instrumentation), handler throws (request.middleware
  // catch) and operation failures are covered by ONE hook with no double capture. No-op outside
  // PRODUCTION or without a key. Placed AFTER the rate-limit gate (shouldLogMessage), so it
  // inherits the dedup and does not flood the quota.
  captureBackendIssue(data);
};
