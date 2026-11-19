import type { EVENT_INFO_TYPE } from '../domain/commands-and-queries/cqrs.types';
import {
  CRITICAL_REDIRECTIONS_ON_EVENTS,
  REDIRECTIONS_ON_EVENTS,
  ROUTES_FRONT_APP,
  ROUTES_FRONT_STATIC,
} from '../domain/routing/routing.config';
import type { ROUTES_FRONT_PATH } from '../domain/routing/routing.types';

export type ROUTING_POLICY_TYPE = {
  utils: {
    NORMALIZE_PATH: (props: { path?: string }) => string;
    MATCH_DYNAMIC_ROUTE: (props: {
      path: string;
      routeTemplate: string;
    }) => boolean;
    FIND_MATCHING_ROUTE: (props: {
      path: string;
      routes: Record<string, unknown>;
    }) => string | null;
    IS_EXISTS_REDIRECTION_FOR_PASSED_EVENT: (props: {
      event?: EVENT_INFO_TYPE | null;
    }) => boolean;
    IS_THE_SAME_PATH: (props: {
      redirectionRoutePath: ROUTES_FRONT_PATH;
      currentPathname?: ROUTES_FRONT_PATH | string | null;
    }) => boolean;
    IS_APP_PATH: (props: {
      requestedRoutePath?: ROUTES_FRONT_PATH | string | null;
    }) => boolean;
    IS_STATIC_PAGE: (props: {
      requestedRoutePath?: ROUTES_FRONT_PATH | string | null;
    }) => boolean;
  };
};

export const ROUTING_POLICY: ROUTING_POLICY_TYPE = {
  utils: {
    NORMALIZE_PATH: ({ path }) => {
      if (!path) {
        return '';
      }
      const hasTrailingSlashButIsNotRoot = path.endsWith('/') && path !== '/';
      return hasTrailingSlashButIsNotRoot ? path.slice(0, -1) : path;
    },

    MATCH_DYNAMIC_ROUTE: ({ path, routeTemplate }) => {
      if (!path || !routeTemplate) {
        return false;
      }
      if (!routeTemplate.includes('[')) {
        return path === routeTemplate;
      }
      const regexStr = routeTemplate.replace(/\[([^\]]+)\]/g, '([^/]+)');
      const regex = new RegExp(`^${regexStr}$`);
      return regex.test(path);
    },

    FIND_MATCHING_ROUTE: ({ path, routes }) => {
      // Check values first (for ROUTES_FRONT_STATIC / ROUTES_FRONT_APP where values are paths)
      for (const val of Object.values(routes)) {
        if (
          typeof val === 'string' &&
          ROUTING_POLICY.utils.MATCH_DYNAMIC_ROUTE({ path, routeTemplate: val })
        ) {
          return val;
        }
      }
      // Check keys (for PERMISSIONS_FOR_ROLE_BY_ROUTE where keys are paths)
      for (const key of Object.keys(routes)) {
        if (
          ROUTING_POLICY.utils.MATCH_DYNAMIC_ROUTE({ path, routeTemplate: key })
        ) {
          return key;
        }
      }
      return null;
    },

    IS_THE_SAME_PATH: ({ redirectionRoutePath, currentPathname }) => {
      if (!currentPathname) {
        return false;
      }
      const currentPath = ROUTING_POLICY.utils.NORMALIZE_PATH({
        path: currentPathname,
      });
      const requestedPath = ROUTING_POLICY.utils.NORMALIZE_PATH({
        path: redirectionRoutePath,
      });
      return currentPath === requestedPath;
    },

    IS_EXISTS_REDIRECTION_FOR_PASSED_EVENT: ({ event }) => {
      // DECISION: own-key membership, not `in`. `in` walks the whole prototype chain, so on an object
      // literal it answers yes for 'constructor', 'toString' and the rest of Object.prototype and the
      // lookup returns a function instead of a route (the same class broke getPlanConfig). `event`
      // comes from our backend, so this is unreachable today, but own keys are what we actually ask
      // about and it costs the same. `hasOwnProperty.call`, not `Object.hasOwn`: the kernel also
      // compiles under the tests tsconfig, whose lib is lower (`hasOwn` = ES2022).
      const key = event ?? '';
      const hasOwn = (obj: object): boolean =>
        Object.prototype.hasOwnProperty.call(obj, key);
      return (
        hasOwn(REDIRECTIONS_ON_EVENTS ?? {}) ||
        hasOwn(CRITICAL_REDIRECTIONS_ON_EVENTS ?? {})
      );
    },

    IS_APP_PATH: ({ requestedRoutePath }) => {
      if (!requestedRoutePath) {
        return false;
      }
      const pathToCheck = ROUTING_POLICY.utils.NORMALIZE_PATH({
        path: requestedRoutePath,
      });
      return Boolean(
        ROUTING_POLICY.utils.FIND_MATCHING_ROUTE({
          path: pathToCheck,
          routes: ROUTES_FRONT_APP,
        })
      );
    },

    IS_STATIC_PAGE: ({ requestedRoutePath }) => {
      if (!requestedRoutePath) {
        return false;
      }
      const pathToCheck = ROUTING_POLICY.utils.NORMALIZE_PATH({
        path: requestedRoutePath,
      });
      return Boolean(
        ROUTING_POLICY.utils.FIND_MATCHING_ROUTE({
          path: pathToCheck,
          routes: ROUTES_FRONT_STATIC,
        })
      );
    },
  },
} as const;
