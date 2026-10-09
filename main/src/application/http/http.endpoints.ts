import type { EVENT_COMMANDS_AND_QUERIES_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import { ROUTES_API } from '@kernel/domain/routing/routing.config';

export type EndpointProps = {
  ENV_VARS: {
    readonly NEXT_PUBLIC_HTTP_PROTOCOL: string;
    readonly NEXT_PUBLIC_BACKEND_PUBLIC_PORT: string;
    readonly NEXT_PUBLIC_BACKEND_PUBLIC_DOMAIN: string;
  };
  payload?: string;
};

export type EndpointURLFunction = (props: EndpointProps) => string;

const URL: EndpointURLFunction = props => {
  const port = props.ENV_VARS.NEXT_PUBLIC_BACKEND_PUBLIC_PORT;
  return `${props.ENV_VARS.NEXT_PUBLIC_HTTP_PROTOCOL}${props.ENV_VARS.NEXT_PUBLIC_BACKEND_PUBLIC_DOMAIN}${port ? `:${port}` : ''}`;
};

// --- Builder ---

type RoutesAPIKey = keyof typeof ROUTES_API;

/** CQRS keys that map to a DIFFERENT ROUTES_API key */
const ROUTE_ALIASES: Partial<
  Record<EVENT_COMMANDS_AND_QUERIES_TYPE, RoutesAPIKey>
> = {
  USER_LOGOUT: 'SESSION_DELETE_ALL',
  SALON_STAFF_INVITE: 'SALON_STAFF',
  SALON_STAFF_GET_ALL: 'SALON_STAFF',
};

// DECISION (nie usuwaj tego komentarza):
// PLACEHOLDER_ENDPOINTS removed in F2 — USER_CREATE handled by Better Auth provider routes,
// USER_ENABLE_SELF nie istnieje jako CQRS event (re-enable via login). Brak placeholderów = brak
// martwego API surface które myli debugging.

/** ROUTES_API keys used only via aliases (not a CQRS key themselves) */
const ALIAS_ONLY_ROUTES: ReadonlySet<string> = new Set<RoutesAPIKey>([
  'SALON_STAFF',
  // Not CQRS events — served by dedicated maps below (DEV_ENDPOINTS / AUTH_ENDPOINTS)
  // or S2S. Excluded from the CQRS-typed ENDPOINTS map (else dead entries masked by
  // the final cast: they are not EVENT_COMMANDS_AND_QUERIES_TYPE, so unreachable in
  // typed code anyway — listing them here keeps the map free of dead runtime keys).
  'INTERNAL_TRACK_CRAWLER',
  'DEV_LOGIN',
  'AUTH_EXCHANGE_CODE',
]);

const buildEndpoints = (): Record<
  EVENT_COMMANDS_AND_QUERIES_TYPE,
  EndpointURLFunction
> => {
  const map: Record<string, EndpointURLFunction> = {};

  // 1. Direct 1:1 mappings (CQRS key === ROUTES_API key)
  for (const key of Object.keys(ROUTES_API) as RoutesAPIKey[]) {
    if (ALIAS_ONLY_ROUTES.has(key)) {
      continue;
    }
    map[key] = (p: EndpointProps) => `${URL(p)}${ROUTES_API[key]}`;
  }

  // 2. Aliases (CQRS key !== ROUTES_API key)
  for (const [cqrsKey, routeKey] of Object.entries(ROUTE_ALIASES)) {
    map[cqrsKey] = (p: EndpointProps) =>
      `${URL(p)}${ROUTES_API[routeKey as RoutesAPIKey]}`;
  }

  return map as Record<EVENT_COMMANDS_AND_QUERIES_TYPE, EndpointURLFunction>;
};

export const ENDPOINTS: Record<
  EVENT_COMMANDS_AND_QUERIES_TYPE,
  EndpointURLFunction
> = buildEndpoints();

// Dev-only endpoints (not part of standard CQRS flow)
export const DEV_ENDPOINTS = {
  DEV_LOGIN: (props: EndpointProps) => `${URL(props)}${ROUTES_API.DEV_LOGIN}`,
} as const;

// Auth transport endpoints (Better Auth surface under /api/auth/*, NOT /api/v1/*).
// These are not CQRS command/query events, so they are not part of the ENDPOINTS
// map (which is keyed by EVENT_COMMANDS_AND_QUERIES_TYPE). AUTH_EXCHANGE_CODE is
// the variant-C post-login token bridge: POST { authCode } → bearer token returned
// in the `authorization` response header (handed to the caller, NOT persisted:
// exchangeAuthCode_IO uses captureResponseAuthorization, s34 login-CSRF gate).
export const AUTH_ENDPOINTS = {
  EXCHANGE_CODE: (props: EndpointProps) =>
    `${URL(props)}${ROUTES_API.AUTH_EXCHANGE_CODE}`,
} as const;
