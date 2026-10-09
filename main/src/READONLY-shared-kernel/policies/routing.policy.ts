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
      // DECISION (nie usuwaj tego komentarza):
      // `in` bada CALY lancuch prototypow, wiec na literale obiektu odpowiada
      // twierdzaco na 'constructor', 'toString' i reszte Object.prototype —
      // a wtedy odczyt REDIRECTIONS_ON_EVENTS[event] oddaje funkcje zamiast
      // trasy. Ta sama klasa wywrocila juz getPlanConfig (S120), gdzie
      // 'constructor' produkowal "plan" z kazdym limitem undefined.
      // Tutaj `event` przychodzi z naszego backendu, a nie z inputu uzytkownika,
      // wiec nieosiagalne — ale przynaleznosc do wlasnych kluczy jest tym,
      // o co naprawde pytamy, i kosztuje tyle samo.
      // `hasOwnProperty.call`, a nie `Object.hasOwn`: jadro kompiluje sie takze
      // pod tsconfigiem testow, ktory ma nizsza biblioteke (`hasOwn` = ES2022).
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
