import { IntlErrorCode, type IntlError } from 'next-intl';
import { reportIssueFrontend } from '../error-debugger/errorHandler.possibilities.api';
import {
  ARE_DEV_ROUTES_ENABLED,
  IS_DEVELOPMENT_ENV,
} from '../environment/environment.possibilities.api';

// One report per distinct problem per page load (a missing key renders on every re-render).
const reportedThisPageLoad = new Set<string>();

/** Test seam: forget what this page load already reported. */
export const resetReportedIntlErrors = (): void => {
  reportedThisPageLoad.clear();
};

/**
 * `onError` for the app's NextIntlClientProvider: each distinct problem goes to the error store ONCE
 * per page load (a missing key fires on every re-render). `reportIssueFrontend` also prints it to the
 * console, which is what next-intl's own default did, so development loses nothing; everywhere else
 * a missing message stops being invisible (the user sees a blank and nobody hears about it).
 */
export const handleIntlError = (error: IntlError): void => {
  const dedupeKey = `${error.code}:${error.originalMessage ?? error.message}`;
  if (reportedThisPageLoad.has(dedupeKey)) {
    return;
  }
  reportedThisPageLoad.add(dedupeKey);
  reportIssueFrontend({
    namespace: 'I18N',
    message:
      error.code === IntlErrorCode.MISSING_MESSAGE
        ? 'Missing translation message'
        : `Translation error ${error.code}`,
    payload: {
      code: error.code,
      detail: error.originalMessage ?? error.message,
      path: typeof window === 'undefined' ? null : window.location.pathname,
    },
    mode: 'error',
  });
};

/**
 * DECISION: in production a MISSING message renders as an EMPTY string, not as its key path. A key
 * (`pages.pricing.cta.title`) is internal vocabulary in the middle of a Polish sentence: it reads as
 * a broken product and leaks names, while a blank label leaves the surrounding layout, icons and
 * every other label intact. Humanising the last segment would print English words on a Polish
 * screen. Development and staging keep the key so testers can see which one is missing, and every
 * environment reports it (`handleIntlError`), which is what actually gets it fixed.
 * Other errors (formatting) keep the key path: the message exists and only its arguments failed.
 */
export const getIntlMessageFallback = ({
  namespace,
  key,
  error,
}: {
  namespace?: string;
  key: string;
  error: IntlError;
}): string => {
  if (
    error.code === IntlErrorCode.MISSING_MESSAGE &&
    !IS_DEVELOPMENT_ENV() &&
    !ARE_DEV_ROUTES_ENABLED()
  ) {
    return '';
  }
  return [namespace, key]
    .filter(part => part !== undefined && part !== '')
    .join('.');
};
