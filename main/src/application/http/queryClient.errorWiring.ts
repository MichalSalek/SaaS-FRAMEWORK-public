// main/src/application/http/queryClient.errorWiring.ts
// Bootstrap wiring: connects the QueryClient's global MutationCache.onError
// fallback to the app snackbar layer.
//
// Why a separate module (import-cycle break, madge skipTypeImports):
// `queryClient.config` is a bootstrap foundation. Importing `pushNewSnackbar`
// directly there created a value↔value cycle
// (queryClient.config → appSnackbar → errorHandler → queryClient.config),
// because the error handler reads the current user from `queryClient`. Keeping
// the snackbar wiring in this leaf module (imported once from `_app.tsx`)
// removes the static edge while preserving identical runtime behavior: the
// generic error snackbar still fires for any mutation without
// `meta.suppressGlobalError`. See the DECISION comments in `queryClient.config`
// for the full double-toast / suppressGlobalError contract.

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { pushNewSnackbar } from '../app-snackbar/appSnackbar.possibilities.api';
import {
  registerGlobalMutationErrorHandler,
  registerStaleConnectivityHandler,
} from './queryClient.config';

registerGlobalMutationErrorHandler(() => {
  pushNewSnackbar(APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR, 'error');
});

// A refetch failed on connectivity while the screen keeps cached data: the one
// read failure no screen shows inline (queryClient.config, error-feedback.policy).
registerStaleConnectivityHandler(() => {
  pushNewSnackbar(
    APP_EVENTS.INFO.APPLICATION.INTERNET_CONNECTION_PROBLEM,
    'warning'
  );
});
