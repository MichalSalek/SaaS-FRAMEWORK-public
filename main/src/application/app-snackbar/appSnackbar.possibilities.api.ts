import { isEventDisallowedForUI } from '@kernel/domain/commands-and-queries/cqrs.config';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import { reportIssueFrontend } from '../error-debugger/errorHandler.possibilities.api';
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

// DECISION (nie usuwaj tego komentarza):
// Signature accepts `string | EVENT_INFO_TYPE | undefined` intentionally — there
// are two valid call modes: (1) event-key mode (`APP_EVENTS.INFO.*` or
// `response.event`), translated at display time by AppSnackbarsController via
// `useTranslations('events')`; (2) pre-translated string mode (`t('foo.bar')`),
// rendered as-is when the event-key lookup falls back. Tightening to
// `EVENT_INFO_TYPE | undefined` was proposed in an audit but breaks ~90 valid
// call sites that pass `t(...)` strings (next-intl `t` returns `string`, not
// `EVENT_INFO_TYPE`). The graceful fallback in `translateEventMessage` is what
// keeps both modes safe.
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

  // Translation happens at display time in AppSnackbarsController (useTranslations('events'))
  // Raw event names are stored in the snackbar queue for debugging consistency.
  // Active-toast deduplication belongs to the Sonner adapter: a stable toast `id`
  // updates the already-visible message instead of relying on a retry-sensitive timer.
  useSnackbarStore.getState().push(generateAppAlertWrapper(input, color));
};
