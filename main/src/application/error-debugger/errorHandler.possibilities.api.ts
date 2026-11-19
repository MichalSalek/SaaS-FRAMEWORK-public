import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import type { SafeCurrentUser } from '@kernel/models/session/session.dto';
import type { UserMetadata } from '@kernel/models/db_models.manual.dto';
import {
  getEnvironmentMode,
  IS_DEVELOPMENT_ENV,
} from '../environment/environment.possibilities.api';
import { queryClient } from '../http/queryClient.config';
import { queryKeys } from '../http/queryKeys.factory';
import { captureStackTrace } from './debugger.utils.api';
import type { ReportIssueProps } from './errorDebugger.types';
import { sendEventLogBeacon_IO } from './errorHandlerIO.possibilities.api';
import { getClientVerboseLog } from './client-verbose.state';
import { serializeErrorLike } from '@kernel/application/error-serialization';
import { getDocumentBuildId } from '../lifecycle/document-build';
import { isPrivateNoteKey } from '@kernel/application/diagnostic-redaction';

// Same key set as the backend sanitizer, plus the one-time login code. The
// login exchange posts `{ authCode }` through the shared interceptor, and a
// verbatim payload once landed in the log store.
const SENSITIVE_KEY_REGEX =
  /^(authorization|cookie|set-cookie|x-internal-secret|stripe-signature|token|password|api[_-]?key|secret|access[_-]?token|refresh[_-]?token|bearer|authcode|code)$/i;
const REDACTED = '[REDACTED]';
const MAX_REDACTION_DEPTH = 6;

const redactSecrets = (value: unknown, depth = 0): unknown => {
  if (depth > MAX_REDACTION_DEPTH) {
    return '[TOO_DEEP]';
  }
  if (Array.isArray(value)) {
    return value.map(item => redactSecrets(item, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>
    )) {
      out[key] =
        SENSITIVE_KEY_REGEX.test(key) || isPrivateNoteKey(key)
          ? REDACTED
          : redactSecrets(child, depth + 1);
    }
    return out;
  }
  return value;
};

/**
 * Axios errors nest `response.data.data` past serializeErrorLike's depth cap,
 * so the useful fields became "[max depth reached]". Pull status, event and
 * one level of response data up before that walk.
 */
const hoistHttpSummary = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  const response = record.response;
  if (response === null || typeof response !== 'object') {
    return value;
  }
  const res = response as { status?: unknown; data?: unknown };
  const body = res.data;
  const event =
    body !== null && typeof body === 'object' && 'event' in body
      ? (body as { event?: unknown }).event
      : null;
  const inner =
    body !== null && typeof body === 'object' && 'data' in body
      ? (body as { data?: unknown }).data
      : body;
  return {
    status: res.status ?? null,
    event,
    data: inner ?? null,
    request: 'request' in record ? record.request : (record.payload ?? null),
  };
};

// The browser owns agent/language provenance. The ingest endpoint stores this snapshot;
// leaving these null lost the context needed to diagnose historical client exceptions.
const getFrontendUserMetadata = (): UserMetadata => ({
  client_ip: null,
  language: navigator.language || null,
  user_agent: navigator.userAgent || null,
  location: null,
});

export const reportIssueFrontend = (data: ReportIssueProps): void => {
  // DECISION: the reporter is CLIENT-SIDE. On the server (SSR / `next build` prerender) there is no
  // window or storage, so storage-adapter reads hit the `typeof storage === 'undefined'` branch and
  // logged "No storage access!" as mode:'error': hundreds of entries flooded the build log and
  // fired sendEventLogBeacon_IO (a POST during prerender). No storage on the server is the
  // environment, not an error; the guard drops ALL server-side reporting because those storage
  // misses are its only server callers, and real runtime errors surface on the client.
  if (typeof window === 'undefined') {
    return;
  }

  // Info-tier gate = the single VERBOSE_LOG_MODE switch, mirrored from the public
  // runtime-config (see docs/LOGGING.md + client-verbose.state.ts). warn/error are
  // never gated. This replaces the dead isDevMode Zustand flag (no runtime toggle);
  // the backend re-gates info identically, so front+back share one policy.
  const verboseOn = getClientVerboseLog();

  if (data.mode === 'info' && !verboseOn) {
    return;
  }

  const handledPayload = (): string => {
    switch (typeof data.payload) {
      case 'object':
      default:
        try {
          // serializeErrorLike: `JSON.stringify(new Error(...))` daje `{}` (name/
          // message/stack sa nieenumerowalne), wiec kazdy zgloszony blad ladowal w
          // AppLogRecord bez powodu. Ten sam seam co backend (error-handler.ts) —
          // jedna polityka normalizacji dla obu sinkow.
          return JSON.stringify(
            redactSecrets(serializeErrorLike(hoistHttpSummary(data.payload))),
            undefined,
            2
          );
        } catch {
          return '[Unserializable payload]';
        }

      case 'string':
      case 'number':
      case 'boolean':
        return String(data.payload);

      case 'undefined':
        return 'undefined';
    }
  };

  const callstack = () => {
    if (IS_DEVELOPMENT_ENV()) {
      return captureStackTrace();
    } else {
      return [];
    }
  };

  const currentUser = queryClient.getQueryData<SafeCurrentUser | undefined>(
    queryKeys.account.current
  );

  const input: ADMIN_DTO_API_V1['SEND_LOG']['REQUEST'] = {
    environment: getEnvironmentMode(),
    type: data.mode,
    namespace: data.namespace,
    message: data.message,
    user_id: currentUser?.id ?? null,
    // Origin + path only: the query can carry `?authCode=` (login transport)
    // and the backend drops it anyway (resolveIngestClientUrl).
    client_url: `${window.location.origin}${window.location.pathname}`,
    payload: handledPayload(),
    user_metadata: JSON.stringify({
      sessionId: currentUser?.session?.id ?? null,
      ...getFrontendUserMetadata(),
      buildId: getDocumentBuildId(),
      callstack: callstack(),
    }),
  };

  console[data.mode](input);

  sendEventLogBeacon_IO(input);
};
