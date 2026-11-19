import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';

/**
 * Where a notification row leads (front route, stored on the row so the list
 * never re-derives it from a type that may change meaning later).
 *
 * The parametrised routes of ROUTES_FRONT carry `[param]` segments; the
 * front's `buildRoute` lives in main/, so this is the server-side fill.
 */
const fillRoute = (route: string, params: Record<string, string>): string =>
  Object.entries(params).reduce(
    (path, [key, value]) => path.replace(`[${key}]`, encodeURIComponent(value)),
    route
  );

export const NOTIFICATION_TARGETS = {
  /** The stylist answers a connection request on her client list. */
  pairRequestReceived: (): string => ROUTES_FRONT.CLIENTS,
  /** The client opens the stylist's gallery she now has access to. */
  pairRequestAccepted: (stylistAccountId: string): string =>
    fillRoute(ROUTES_FRONT.STYLIST_GALLERY, { id: stylistAccountId }),
  /** The stylist opens the card of the client who scanned her code. */
  pairConnectedByQr: (clientUserId: string): string =>
    fillRoute(ROUTES_FRONT.CLIENT_CARD, { id: clientUserId }),
  /** The stylist opens the shared inspiration session in her inbox. */
  sessionShared: (sessionId: string): string =>
    fillRoute(ROUTES_FRONT.SESSION_DETAIL, { sessionId }),
  /** The client opens her closed session. */
  sessionClosedByStylist: (sessionId: string): string =>
    fillRoute(ROUTES_FRONT.CLIENT_SESSION_DETAIL, { sessionId }),
  /** The client opens the session that is about to expire. */
  sessionExpiringClient: (sessionId: string): string =>
    fillRoute(ROUTES_FRONT.CLIENT_SESSION_DETAIL, { sessionId }),
  /** Either side opens the conversation. */
  messageReceived: (pairId: string): string =>
    fillRoute(ROUTES_FRONT.MESSAGES_THREAD, { pairId }),
  /** The invited person answers on the invitations screen. */
  salonInvitationReceived: (): string => ROUTES_FRONT.SALON_INVITATIONS,
  /** The owner sees her team. */
  salonInvitationAccepted: (): string => ROUTES_FRONT.SALON_STAFF,
  /** The thread owner reads the team's reply in her support thread. */
  supportReplyReceived: (threadId: string): string =>
    fillRoute(ROUTES_FRONT.SUPPORT_THREAD, { threadId }),
} as const;
