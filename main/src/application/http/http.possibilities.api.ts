import { interceptors } from './http.interceptor';
import { requestHeadersSetter } from './http.utils';
import type { EndpointURLFunction } from './http.endpoints';
import type {
  HTTPError,
  HTTPErrorCallback,
  HTTPSuccess,
  HTTPSuccessCallback,
} from '@kernel/application/http/http.types';
import {
  CUSTOM_HEADERS,
  type HTTPMethod,
} from '@kernel/domain/http/http.config';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { ENV_VARS } from '../environment/environment.config';
import { reportIssueFrontend } from '../error-debugger/errorHandler.possibilities.api';
import { requestCancellationService } from './request-cancellation.service';

import type { HTTPErrorFeedbackPolicy } from './error-feedback.policy';

export type CallHTTPEndpointConfig = {
  url: EndpointURLFunction;
  mode: HTTPMethod;
  payload?: unknown;
  /**
   * Resolved per call by `resolveErrorFeedbackPolicy` (error-feedback.policy.ts):
   * reads issued by the query cache default to background, everything else to
   * foreground; a value declared on the endpoint wins. Foreground: request
   * failures enter the event bus and can show user feedback. Background reads (feature-flags, runtime-config,
   * announcements, identity polling) opt into `background`: NETWORK/TIMEOUT and
   * non-auth HTTP failures settle the query without a per-XHR snackbar. Real HTTP
   * failures are still logged; 401/403 still enter the event pipeline so auth and
   * account-state redirects remain intact.
   */
  errorFeedbackPolicy?: HTTPErrorFeedbackPolicy;
  /**
   * Best-effort enrichment calls opt in here: on a business 4xx response (NOT
   * 401, NOT 5xx) the interceptor fails SOFT — it still settles the query as a
   * HANDLED error (isError → hook falls back to empty) and still logs via
   * reportIssueFrontend, but does NOT push a snackbar. Threaded per-call from
   * `IOClientCallOptions.silentBusinessError`, never static on the endpoint —
   * the same IO function is reused by primary-content hooks that DO want the
   * error toast (e.g. session-detail views vs client-card photo enrichment).
   */
  silentBusinessError?: boolean;
  /**
   * External AbortSignal forwarded from the caller (e.g. TanStack Query's
   * `queryFn({ signal })`). When this signal aborts, the in-flight fetch is
   * cancelled in addition to the internal timeout + logout cancellation. The
   * adapter combines all three sources — whichever fires first wins.
   */
  externalSignal?: AbortSignal;
  /**
   * DECISION (nie usuwaj tego komentarza):
   * When set, a bearer token arriving in the `authorization` RESPONSE header is
   * handed to this callback INSTEAD of being written to
   * localStorage['authorization'] by the headers interceptor. Only the
   * ?authCode exchange uses it (s34 login-CSRF gate): the token of a login this
   * browser may not have asked for must stay in the exchanging document's
   * memory until the user confirms the account, because anything in storage is
   * live immediately for a reload and for every other open tab.
   */
  captureResponseAuthorization?: (token: string) => void;
};

// Hard cap so the UI never spins forever against a stuck/unreachable backend.
// Image uploads and other long-running operations must override this in the
// adapter or use a streaming-aware fetcher. 30s matches typical CDN edge timeouts.
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

type CallHTTPEndpoint<ResPayload, ErrorPayload> = {
  config: CallHTTPEndpointConfig;
  successCallback: HTTPSuccessCallback<ResPayload>;
  errorCallback: HTTPErrorCallback<ErrorPayload>;
};

// Native fetch adapter replacing axios.
// Edge cases: FormData (correction #2), DELETE body (#6), empty response 204 (#7).
async function httpHandlerAction<SuccessData, ErrorData>(opts: {
  url: string;
  mode: HTTPMethod;
  headers: Record<string, string>;
  payload?: unknown;
  signal: AbortSignal;
  requestId: string;
  isTimeout: () => boolean;
  fireOnSuccess: (response: {
    data: SuccessData;
    headers?: unknown;
  }) => Promise<void>;
  fireOnCatch: (error: {
    response?: { data?: ErrorData; status?: number; headers?: unknown };
    message?: string;
    code?: string;
  }) => Promise<void>;
}): Promise<void> {
  try {
    const isBodyMethod =
      opts.mode === 'post' || opts.mode === 'patch' || opts.mode === 'delete';
    const isFormData = opts.payload instanceof FormData;

    const fetchHeaders: Record<string, string> = {
      // Do NOT set Content-Type for FormData — browser sets multipart/form-data with boundary
      ...(isBodyMethod && !isFormData
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...opts.headers,
    };

    const body: BodyInit | null =
      isBodyMethod && opts.payload !== undefined
        ? isFormData
          ? (opts.payload as FormData)
          : JSON.stringify(opts.payload)
        : null;

    const fetchOpts: RequestInit = {
      method: opts.mode.toUpperCase(),
      headers: fetchHeaders,
      body,
      signal: opts.signal,
    };

    const response = await fetch(opts.url, fetchOpts);
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    // Empty response handling (e.g. 204 No Content from DELETE).
    // Non-JSON responses (HTML 502/504 from proxy, plain-text gateway errors)
    // must not blow up JSON.parse — that would surface as a generic catch-all
    // network error and discard the real response.status. Preserve status so
    // the interceptor classifies as HTTP error, not NETWORK.
    const text = await response.text();
    let data: unknown = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        // NIE syntetyzujemy pola `event`: sentinel-string wyciekał przez
        // error.response.data.event jako klucz snackbara i renderował surowy token
        // 'NON_JSON_RESPONSE' userowi (brak klucza i18n). Bez `event` interceptor
        // fallbackuje na przetłumaczony INTERNET_CONNECTION_PROBLEM (właściwy komunikat
        // dla gateway 502/504). rawText zostaje do diagnostyki.
        data = {
          rawText: text.slice(0, 200),
        };
      }
    }

    if (response.ok) {
      await opts.fireOnSuccess({
        data: data as SuccessData,
        headers: responseHeaders,
      });
    } else {
      await opts.fireOnCatch({
        response: {
          data: data as ErrorData,
          status: response.status,
          headers: responseHeaders,
        },
        message: response.statusText,
      });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const name = e instanceof Error ? e.name : '';
    if (name === 'AbortError') {
      if (opts.isTimeout()) {
        await opts.fireOnCatch({ message: 'timeout', code: 'ERR_TIMEOUT' });
      } else {
        await opts.fireOnCatch({ message: 'canceled', code: 'ERR_CANCELED' });
      }
    } else {
      await opts.fireOnCatch({ message });
    }
  }
}

// @ResPayload <Success response,
// @ErrorPayload Error response>
export const callHTTPEndpoint = async <
  ResPayload = unknown,
  ErrorPayload = unknown,
>({
  config,
  successCallback,
  errorCallback,
}: CallHTTPEndpoint<ResPayload, ErrorPayload>): Promise<void> => {
  const { url, mode, payload = undefined, externalSignal } = config;

  // Generate unique request ID for cancellation registry + debug correlation
  const requestId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const cancellationSignal = requestCancellationService.register(requestId);

  // Combine the existing cancellation signal with a timeout — whichever fires
  // first aborts the fetch. AbortController.abort() on EITHER source propagates
  // through `signal`.
  // DECISION (nie usuwaj tego komentarza):
  // `timedOut` flag MUST be set synchronously BEFORE timeoutController.abort()
  // so httpHandlerAction can distinguish timeout from user cancel (logout).
  // Without it, fetch's AbortError reaches interceptor as ERR_CANCELED →
  // silent skip → React Query mutation stuck in isPending=true forever.
  const timeoutController = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, DEFAULT_REQUEST_TIMEOUT_MS);
  const onCancellation = () => timeoutController.abort();
  cancellationSignal.addEventListener('abort', onCancellation);
  // External signal (e.g. TanStack Query's per-query AbortSignal) — fires
  // when a query is cancelled by TQ (unmount, refocus, new key). Combines
  // with the internal timeout + logout signals; first one to abort wins.
  // Pre-aborted case (`externalSignal.aborted === true`) is handled by
  // calling abort() synchronously so the fetch never starts.
  const onExternalAbort = () => timeoutController.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      timeoutController.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort);
    }
  }
  const signal = timeoutController.signal;

  try {
    const headers = await requestHeadersSetter();

    await httpHandlerAction<HTTPSuccess<ResPayload>, HTTPError<ErrorPayload>>({
      url: url({ ENV_VARS }),
      mode,
      headers,
      payload,
      signal,
      requestId,
      isTimeout: () => timedOut,

      fireOnSuccess: async response_from_adapter => {
        await interceptors.headers({
          headers: response_from_adapter.headers as
            Record<string, string> | undefined,
          captureAuthorization: config.captureResponseAuthorization,
        });
        await interceptors.success<ResPayload>({
          response: response_from_adapter,
          config,
          passCallback: async response => {
            await successCallback(response);
          },
        });
      },

      fireOnCatch: async error_from_adapter => {
        await interceptors.headers({
          headers: error_from_adapter.response?.headers as
            Record<string, string> | undefined,
          captureAuthorization: config.captureResponseAuthorization,
        });
        await interceptors.error<ErrorPayload>({
          error: error_from_adapter,
          config,
          // The exact `authorization` value THIS request carried. Threaded from
          // the already-built request headers (same closure) so the auth
          // teardown can clear a refused token only while it is still the live
          // one — see auth-token-teardown.ts. Free: no plumbing through the
          // adapter's error shape.
          ...(headers[CUSTOM_HEADERS.authorization]
            ? {
                requestAuthorization: headers[CUSTOM_HEADERS.authorization],
              }
            : {}),
          passCallback: async error => {
            await errorCallback(error);
          },
        });
      },
    });
  } catch (e) {
    reportIssueFrontend({
      namespace: 'callHTTPEndpoint',
      message: `error.`,
      payload: e,
      mode: 'error',
    });
    await errorCallback({
      event: APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR,
      data: undefined,
    });
  } finally {
    clearTimeout(timeoutId);
    cancellationSignal.removeEventListener('abort', onCancellation);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
    requestCancellationService.unregister(requestId);
  }
};
