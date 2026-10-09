import type { SnackbarWrapper } from '../../application/app-snackbar/appSnackbar.types';
import {
  deleteFromClientStorage,
  setToClientStorage,
} from '../../application/client-device-storage/clientStorage.possibilities.api';
import { __debuggerGate } from '../../application/error-debugger/debugger.utils.api';
import { reportIssueFrontend } from '../../application/error-debugger/errorHandler.possibilities.api';
import { pushEventToBus } from '../../application/event-bus/eventBus.possibilities.api';
import {
  isAuthRejection,
  tearDownRejectedSessionToken,
} from '../auth/auth-token-teardown';
import { ENV_VARS } from '../environment/environment.config';
type HTTPAdapterSuccess<T> = { data: T; headers?: unknown };
type HTTPAdapterError<T> = {
  response?: { data?: T; status?: number; headers?: unknown };
  message?: string;
  code?: string;
};
type HTTPClientError = {
  type: 'CANCELLED' | 'TIMEOUT' | 'NETWORK' | 'UNKNOWN';
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
  if (!error.response) {
    return { type: 'NETWORK' };
  }
  return { type: 'UNKNOWN' };
};
import type { CallHTTPEndpointConfig } from '../http/http.possibilities.api';
import { CLEAR_THIS_HEADER_COMMAND_VALUE } from '@kernel/application/http/http.config';
import type {
  HTTPError,
  HTTPErrorCallback,
  HTTPSuccess,
  HTTPSuccessCallback,
} from '@kernel/application/http/http.types';
import type { HTTPStatus } from '@kernel/domain/http/http.config';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { ROUTING_POLICY } from '@kernel/policies/routing.policy';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

type OnEveryCallHeadersInterceptor = {
  headers: Record<string, string> | undefined;
  /** CallHTTPEndpointConfig.captureResponseAuthorization: when present, the
   *  response bearer goes to the caller and storage is left untouched. */
  captureAuthorization?: ((token: string) => void) | undefined;
};

const onEveryCallHeadersSideEffectInterceptor = async ({
  headers,
  captureAuthorization,
}: OnEveryCallHeadersInterceptor) => {
  if (!headers) {
    return void undefined;
  }

  // Authorization token from response (e.g. restored after become-user switch-back)
  const authorizationValue = headers[CUSTOM_HEADERS['authorization']];
  if (
    authorizationValue &&
    authorizationValue !== CLEAR_THIS_HEADER_COMMAND_VALUE
  ) {
    if (captureAuthorization) {
      captureAuthorization(authorizationValue);
    } else {
      setToClientStorage({
        key: CUSTOM_HEADERS['authorization'],
        value: authorizationValue,
      });
    }
  }
  // Defensive branch: the backend currently sends CLEAR only on the becomeUser
  // header (switch-back), never on authorization — kept as cheap protection in
  // case a future response ever asks to drop the auth token. A capturing call
  // owns no storage, so it never clears either.
  if (
    authorizationValue === CLEAR_THIS_HEADER_COMMAND_VALUE &&
    !captureAuthorization
  ) {
    deleteFromClientStorage({ key: CUSTOM_HEADERS['authorization'] });
  }

  // Become user authorization (admin impersonation - kept for admin functionality).
  // Same set/clear contract as the authorization branch above: a CLEAR command
  // value is never persisted, only real tokens are.
  const switchUserValue = headers[CUSTOM_HEADERS['becomeUser']];
  if (switchUserValue && switchUserValue !== CLEAR_THIS_HEADER_COMMAND_VALUE) {
    setToClientStorage({
      key: CUSTOM_HEADERS['becomeUser'],
      value: switchUserValue,
      sessionOnly: true,
    });
  }
  if (switchUserValue === CLEAR_THIS_HEADER_COMMAND_VALUE) {
    deleteFromClientStorage({ key: CUSTOM_HEADERS['becomeUser'] });
  }
};

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
    payload: { snackbarColor: 'success' },
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

  // AUTH TEARDOWN — runs BEFORE the event bus so the pipeline's redirect to
  // /user/login already happens with a clean storage. The server has answered
  // and refused the presented credentials, so the bearer token is provably dead;
  // tearDownRejectedSessionToken drops it only when it is still the LIVE token
  // (no fresh-login race) and no impersonation is active. Without this, a dead
  // token survived forever and the native pre-paint bridge kept routing
  // cold-starts to /app → 401 → login, making /welcome unreachable.
  if (isAuthRejection({ event, status: error.response?.status })) {
    const didClear = tearDownRejectedSessionToken({
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

  // DECISION (nie usuwaj tego komentarza): event sam nie niesie kontekstu UX.
  // Ten sam GENERAL_ERROR ma toastować po foreground mutacji użytkownika, ale nie
  // per każdy background XHR (feature flags / announcements / runtime config /
  // identity poll). Background failures nadal przeszły przez passCallback, a realne
  // HTTP 4xx/5xx są logowane niżej. 401/403 pozostają jawnie poza suppression:
  // niosą re-auth/account-state/permission eventy, które event pipeline musi dostać
  // dla krytycznych redirectów i bezpiecznej ewikcji.
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
    const isExpectedExchangeMiss =
      errorStatusCode === 404 &&
      (event === APP_EVENTS.INFO.USER.LOGIN_TOKEN_EXCHANGE_FAILED ||
        loggedUrl.includes('/api/auth/exchange-code'));
    const isMissingClientProfile =
      errorStatusCode === 404 && loggedUrl.includes('/api/v1/client/profile');
    reportIssueFrontend({
      namespace: 'onCatchMainInterceptor',
      message: `HTTP ERROR ${errorStatusCode} ${config.mode} ${loggedUrl}`,
      payload: {
        status: errorStatusCode,
        event,
        data: responseBody?.data ?? null,
        request: config.payload,
      },
      mode: isExpectedExchangeMiss || isMissingClientProfile ? 'warn' : 'error',
    });
  }

  return Promise.resolve();
};

export const interceptors = {
  success: onSuccessMainInterceptor,
  error: onCatchMainInterceptor,
  headers: onEveryCallHeadersSideEffectInterceptor,
} as const;
