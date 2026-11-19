import Router from 'next/router';
import { runInstant } from './navigation.possibilities.api';
import { __debuggerGate } from '../error-debugger/debugger.utils.api';
import { reportIssueFrontend } from '../error-debugger/errorHandler.possibilities.api';
import { REDIRECTIONS_ON_EVENTS } from '@kernel/domain/routing/routing.config';
import type { ROUTES_FRONT_PATH } from '@kernel/domain/routing/routing.types';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import { ROUTING_POLICY } from '@kernel/policies/routing.policy';

type RedirectToActionProps = {
  routePath: ROUTES_FRONT_PATH;
  /**
   * Optional query string to append to the target route. Provided WITHOUT
   * the leading "?" (e.g. `from=%2Fapp%2Fdashboard`). DD2-D7: used by the
   * login redirect path to round-trip the originally-requested URL.
   */
  query?: string;
  callbackAfterRedirection?: () => void;
};

export const redirectToAction = async ({
  routePath,
  query,
  callbackAfterRedirection,
}: RedirectToActionProps) => {
  const currentPathname =
    typeof window !== 'undefined'
      ? window.location.pathname
      : (Router.asPath ?? '');
  const willBeRedirect = !ROUTING_POLICY.utils.IS_THE_SAME_PATH({
    redirectionRoutePath: routePath,
    currentPathname,
  });
  const finalUrl =
    typeof query === 'string' && query.length > 0
      ? `${routePath}?${query}`
      : routePath;
  const redirectAction = async () => await Router.replace(finalUrl);
  __debuggerGate(() =>
    reportIssueFrontend({
      namespace: 'redirectToAction',
      message: `willBeRedirect: "${willBeRedirect}" `,
      payload: null,
      mode: 'info',
    })
  );
  if (willBeRedirect) {
    __debuggerGate(() =>
      reportIssueFrontend({
        namespace: 'redirectToAction',
        message: `redirection to route "${routePath}" - redirecting...`,
        payload: null,
        mode: 'info',
      })
    );

    await runInstant('event-redirect', redirectAction, finalUrl);
    typeof callbackAfterRedirection === 'function' &&
      callbackAfterRedirection();
  } else {
    __debuggerGate(() =>
      reportIssueFrontend({
        namespace: 'redirectToAction',
        message: `redirection to route "${routePath}" - not going to happen.`,
        payload: null,
        mode: 'info',
      })
    );
  }
};

export const redirectToByEvent = async ({
  event,
  callbackAfterRedirection,
}: {
  event: EVENT_INFO_TYPE;
  callbackAfterRedirection?: () => void;
}) => {
  const routePath: ROUTES_FRONT_PATH | undefined =
    REDIRECTIONS_ON_EVENTS[event];

  if (routePath) {
    await redirectToAction({
      routePath,
      ...(callbackAfterRedirection && { callbackAfterRedirection }),
    });
  }
};
