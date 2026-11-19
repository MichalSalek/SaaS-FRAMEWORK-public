import { isEventDisallowedForUI } from '@kernel/domain/commands-and-queries/cqrs.config';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import { reportIssueFrontend } from '../error-debugger/errorHandler.possibilities.api';
import { IS_DEVELOPMENT_ENV } from '../environment/environment.possibilities.api';
import { useSnackbarStore } from './appSnackbar.store';
import type { SnackbarWrapper } from './appSnackbar.types';

// Internal utility function
const generateAppAlertWrapper = (
  message: string,
  color: SnackbarWrapper['color'] = 'success'
): SnackbarWrapper => ({
  message,
  color,
});

// DECISION: the signature accepts `string | EVENT_INFO_TYPE | undefined` on purpose. Two call
// modes are valid: an event key (`APP_EVENTS.INFO.*` / `response.event`) translated at display time
// by AppSnackbarsController, and a pre-translated string (`t('foo.bar')`) rendered as-is when the
// event-key lookup falls back. Tightening to `EVENT_INFO_TYPE` breaks ~90 call sites that pass
// `t(...)` (next-intl returns `string`); the fallback in `translateEventMessage` keeps both safe.
export const pushNewSnackbar = (
  input: string | EVENT_INFO_TYPE | undefined,
  color?: SnackbarWrapper['color']
): void => {
  if (!input) {
    reportIssueFrontend({
      namespace: 'NO MESSAGE FOR pushNewSnackbar',
      message: `No blob.`,
      payload: {
        message: input,
        color,
      },
      mode: 'error',
    });
    return void undefined;
  }

  if (isEventDisallowedForUI(input)) {
    return void undefined;
  }

  if (color === undefined || color === 'success') {
    watchDoubleSuccess(input);
  }

  // Translation happens at display time in AppSnackbarsController (useTranslations('events'))
  // Raw event names are stored in the snackbar queue for debugging consistency.
  // Active-toast deduplication belongs to the Sonner adapter: a stable toast `id`
  // updates the already-visible message instead of relying on a retry-sensitive timer.
  useSnackbarStore.getState().push(generateAppAlertWrapper(input, color));
};

// === Dev-only net: two success confirmations for one outcome ===
//
// One owner per success outcome (`successFeedback` on the IO call): the event
// toast OR the screen. The static guard (success-feedback-owner.test.ts) sees
// onSuccess callbacks; this net catches what it cannot (a success toast pushed
// outside onSuccess, a never-declared flow). The pipeline marks its own push
// with `noteEventSuccessToast` right BEFORE pushNewSnackbar, so the very next
// push is known to be the event's; any other success push within the window
// of an event toast (either order) is reported. Development builds only.
const DOUBLE_SUCCESS_WINDOW_MS = 1000;
let nextPushIsEvent = false;
let lastEventSuccess: { event: string; at: number } | null = null;
let lastLocalSuccess: { message: string; at: number } | null = null;

const reportDoubleSuccess = (event: string, message: string): void => {
  reportIssueFrontend({
    namespace: 'double success feedback',
    message: `event toast ${event} and a screen success toast "${message}" for one outcome; declare successFeedback on the IO call or drop one`,
    payload: { event, message },
    mode: 'warn',
  });
};

/** Called by the event pipeline right before it pushes a success toast. */
export const noteEventSuccessToast = (event: string): void => {
  if (!IS_DEVELOPMENT_ENV()) {
    return;
  }
  nextPushIsEvent = true;
  const at = Date.now();
  lastEventSuccess = { event, at };
  if (
    lastLocalSuccess !== null &&
    at - lastLocalSuccess.at <= DOUBLE_SUCCESS_WINDOW_MS
  ) {
    reportDoubleSuccess(event, lastLocalSuccess.message);
  }
};

const watchDoubleSuccess = (message: string): void => {
  if (!IS_DEVELOPMENT_ENV()) {
    return;
  }
  if (nextPushIsEvent) {
    nextPushIsEvent = false;
    return;
  }
  const at = Date.now();
  lastLocalSuccess = { message, at };
  if (
    lastEventSuccess !== null &&
    at - lastEventSuccess.at <= DOUBLE_SUCCESS_WINDOW_MS
  ) {
    reportDoubleSuccess(lastEventSuccess.event, message);
  }
};
