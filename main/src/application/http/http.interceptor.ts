import { httpErrorLogLevel } from './http-error-log-level';
import { onEveryCallHeadersSideEffectInterceptor } from './http-header.interceptor';
import type { SnackbarWrapper } from '../../application/app-snackbar/appSnackbar.types';
import { __debuggerGate } from '../../application/error-debugger/debugger.utils.api';
import { reportIssueFrontend } from '../../application/error-debugger/errorHandler.possibilities.api';
import { pushEventToBus } from '../../application/event-bus/eventBus.possibilities.api';
import {
  isAuthRejection,
  tearDownRejectedSessionTokenWithLock,
} from '../auth/auth-token-teardown';
import { ENV_VARS } from '../environment/environment.config';
type HTTPAdapterSuccess<T> = { data: T; headers?: unknown };
type HTTPAdapterError<T> = {
  response?: { data?: T; status?: number; headers?: unknown };
  message?: string;
  code?: string;
  stack?: string;
};
type HTTPClientError = {
  type: 'CANCELLED' | 'TIMEOUT' | 'NETWORK' | 'CLIENT' | 'UNKNOWN';
};
const resolveLoggedUrl = (config: CallHTTPEndpointConfig): string => {
  const resolved = config.url({ ENV_VARS });
  return typeof resolved === 'string' ? resolved : '[unresolved url]';
};

const toHTTPClientError = (
  error: HTTPAdapterError<unknown>
): HTTPClientError => {
  if (error.code === 'ERR_TIMEOUT') {
    return { type: 'TIMEOUT' };
  }
  if (error.code === 'ERR_CANCELED') {
    return { type: 'CANCELLED' };
  }
  if (error.code === 'ERR_CLIENT_REQUEST') {
    return { type: 'CLIENT' };
  }
  if (!error.response) {
    return { type: 'NETWORK' };
  }
  return { type: 'UNKNOWN' };
};
import type { CallHTTPEndpointConfig } from '../http/http.possibilities.api';
import type {
  HTTPError,
  HTTPErrorCallback,
  HTTPSuccess,
  HTTPSuccessCallback,
} from '@kernel/application/http/http.types';
import type { HTTPStatus } from '@kernel/domain/http/http.config';
import { ROUTING_POLICY } from '@kernel/policies/routing.policy';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

type SuccessInterceptor<ResPayload> = {
  response: HTTPAdapterSuccess<HTTPSuccess<ResPayload>>;
  config: CallHTTPEndpointConfig;
  passCallback: HTTPSuccessCallback<ResPayload>;
};
const onSuccessMainInterceptor = async <ResPayload>(
  props: SuccessInterceptor<ResPayload>
) => {
  const { response, passCallback } = props;
  const event = response.data.event;

  if (ROUTING_POLICY.utils.IS_EXISTS_REDIRECTION_FOR_PASSED_EVENT({ event })) {
    __debuggerGate(() =>
      reportIssueFrontend({
        namespace: 'onSuccessMainInterceptor',
        message: `event exists: `,
        payload: event,
        mode: 'info',
      })
    );
  }

  await passCallback(response.data);

  // Handle success event by event bus.
  //
  await pushEventToBus({
    event,
    payload: {
      snackbarColor: 'success',
      ...(props.config.successFeedback !== undefined &&
      props.config.successFeedback !== 'event'
        ? { successFeedback: props.config.successFeedback }
        : {}),
      ...(event === APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_SENT
        ? {
            outcomeEvidence: {
              created:
                typeof response.data.data === 'object' &&
                response.data.data !== null &&
                'created' in response.data.data
                  ? response.data.data.created
                  : undefined,
            },
          }
        : {}),
    },
  });
};

type ErrorInterceptor<ErrorPayload> = {
  error: HTTPAdapterError<HTTPError<ErrorPayload>>;
  config: CallHTTPEndpointConfig;
  passCallback: HTTPErrorCallback<ErrorPayload>;
  /**
   * The `authorization` header value this request actually carried, threaded
   * from the adapter (which builds the headers) so the auth teardown can clear
   * ONLY the token the server just refused — see auth-token-teardown.ts.
   */
  requestAuthorization?: string;
};
const onCatchMainInterceptor = async <ErrorPayload>(
  props: ErrorInterceptor<ErrorPayload>
) => {
  const { passCallback, error, config, requestAuthorization } = props;

  // Cancelled requests (e.g. logout) — silent skip.
  // MUST be BEFORE any other error handling to prevent snackbars/callbacks.
  const clientError = toHTTPClientError(error);
  if (clientError.type === 'CANCELLED') {
    __debuggerGate(() =>
      reportIssueFrontend({
        namespace: 'onCatchMainInterceptor',
        message: `Request cancelled (silent skip): ${config.mode} ${resolveLoggedUrl(config)}`,
        payload: null,
        mode: 'info',
      })
    );
    return;
  }
  if (clientError.type === 'CLIENT') {
    const event = APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR;
    reportIssueFrontend({
      namespace: 'http.client',
      message: `Client request failed: ${config.mode} ${resolveLoggedUrl(config)}`,
      payload: { message: error.message, stack: error.stack },
      mode: 'error',
    });
    await passCallback({ event, data: undefined });
    if (config.errorFeedbackPolicy !== 'background') {
      await pushEventToBus({ event, payload: { snackbarColor: 'error' } });
    }
    return;
  }

  // Background reads fail soft on connectivity errors: when the backend is
  // unreachable (NETWORK) or the request times out, settle WITHOUT pushing
  // INTERNET_CONNECTION_PROBLEM — otherwise every background GET spams a global
  // snackbar on an outage / cold start. "Fail soft" differs per call site:
  // the manual-promise GETs (feature-flags, runtime-config) resolve to their
  // default; announcements goes through toPromise so its query settles as a
  // HANDLED TanStack error (isError → banner renders nothing). Either way: no
  // snackbar, no stuck loader (cleared in callHTTPEndpoint's finally).
  if (
    config.errorFeedbackPolicy === 'background' &&
    (clientError.type === 'NETWORK' || clientError.type === 'TIMEOUT')
  ) {
    await passCallback({
      event: APP_EVENTS.INFO.APPLICATION.INTERNET_CONNECTION_PROBLEM,
      data: undefined,
    });
    return;
  }

  // Timeout: surface as INTERNET_CONNECTION_PROBLEM so React Query's
  // errorCallback fires (mutation leaves isPending=true otherwise) and
  // the user sees a snackbar.
  if (clientError.type === 'TIMEOUT') {
    const timeoutEvent =
      APP_EVENTS.INFO.APPLICATION.INTERNET_CONNECTION_PROBLEM;
    await passCallback({
      event: timeoutEvent,
      data: undefined,
    });
    await pushEventToBus({
      event: timeoutEvent,
      payload: { snackbarColor: 'warning' },
    });
    reportIssueFrontend({
      namespace: 'onCatchMainInterceptor',
      message: `HTTP TIMEOUT ${config.mode} ${resolveLoggedUrl(config)}`,
      payload: { payload: config.payload },
      mode: 'info',
    });
    return;
  }

  const event =
    error.response?.data?.event ??
    APP_EVENTS.INFO.APPLICATION.INTERNET_CONNECTION_PROBLEM;
  const errorStatusCode = (error.response?.status as HTTPStatus | 0) ?? 0;
  const errorPayload = error.response?.data;

  if (isAuthRejection({ event, status: error.response?.status })) {
    const didClear = await tearDownRejectedSessionTokenWithLock({
      rejectedAuthorization: requestAuthorization,
    });
    __debuggerGate(() =>
      reportIssueFrontend({
        namespace: 'authTokenTeardown',
        message: `auth rejection (${event}, status ${String(error.response?.status)}) — session token ${didClear ? 'CLEARED' : 'kept'}`,
        payload: null,
        mode: 'info',
      })
    );
  }

  await passCallback({
    event,
    data: errorPayload?.data,
  });

  // Handle error event by event bus.
  //
  const getSnackbarColor = (): SnackbarWrapper['color'] => {
    const firstCharOfStatusCodeString = String(errorStatusCode ?? '')[0];
    if (firstCharOfStatusCodeString === '4') {
      return 'warning';
    }
    if (firstCharOfStatusCodeString === '5') {
      return 'error';
    }
    return 'info';
  };

  // Best-effort enrichment calls (config.silentBusinessError) fail SOFT on a
  // business 4xx: passCallback above already settled TanStack Query as a HANDLED
  // error (isError → the hook falls back to an empty result), and the
  // reportIssueFrontend below still logs it — we only skip the user-facing
  // snackbar. 401 (re-auth) and 5xx (real server fault) are NEVER suppressed:
  // both must still surface, so they keep toasting even under the flag.
  const suppressBusinessErrorToast =
    config.errorFeedbackPolicy !== 'background' &&
    config.silentBusinessError === true &&
    errorStatusCode >= 400 &&
    errorStatusCode < 500 &&
    errorStatusCode !== 401;

  // DECISION: the event itself carries no UX context. The same GENERAL_ERROR must toast after a
  // foreground user mutation but not for every background XHR (feature flags / announcements /
  // runtime config / identity poll). Background failures still pass through passCallback and real
  // HTTP 4xx/5xx are logged below. 401/403 stay explicitly OUTSIDE the suppression: they carry
  // re-auth / account-state / permission events the event pipeline needs for critical redirects.
  const suppressBackgroundErrorToast =
    config.errorFeedbackPolicy === 'background' &&
    errorStatusCode !== 401 &&
    errorStatusCode !== 403;

  if (!suppressBusinessErrorToast && !suppressBackgroundErrorToast) {
    await pushEventToBus({
      event,
      payload: { snackbarColor: getSnackbarColor() },
    });
  }

  // Handle other errors omitting unauthorized.
  //
  // Skip status 0 = NO HTTP response at all (offline / backgrounded tab /
  // CORS-masked / adblock) = a client connectivity failure, not an app error —
  // logging it pollutes the backend error store with non-actionable entries.
  // The user is still informed: INTERNET_CONNECTION_PROBLEM already fired via
  // pushEventToBus above (snackbar shown). Genuine server faults keep their real
  // 4xx/5xx status and stay reported; 401 re-auth stays untouched.
  if (errorStatusCode !== 401 && errorStatusCode !== 0) {
    const loggedUrl = resolveLoggedUrl(config);
    const responseBody =
      errorPayload !== null && typeof errorPayload === 'object'
        ? errorPayload
        : null;
    reportIssueFrontend({
      namespace: 'onCatchMainInterceptor',
      message: `HTTP ERROR ${errorStatusCode} ${config.mode} ${loggedUrl}`,
      payload: {
        status: errorStatusCode,
        event,
        data: responseBody?.data ?? null,
        request: config.payload,
      },
      mode: httpErrorLogLevel(
        errorStatusCode,
        event,
        loggedUrl,
        responseBody?.data
      ),
    });
  }

  return Promise.resolve();
};

export const interceptors = {
  success: onSuccessMainInterceptor,
  error: onCatchMainInterceptor,
  headers: onEveryCallHeadersSideEffectInterceptor,
} as const;
