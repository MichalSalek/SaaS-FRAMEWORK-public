import { SESSION_CONTAINER_CONFIG } from './session-container.config';

/**
 * The shared-session limit, ONE rule for backend and frontend.
 *
 * DECISION: the limit counts only shared sessions with stylists the client connected to DIRECTLY. A
 * stylist reached through a salon (salon-derived pairing, `salon_origin_account_id`) is outside the
 * cap, exactly as she is outside the client's stylist cap, so a client of a four-stylist salon is not
 * blocked at the fourth (owner). One live session per stylist stays enforced by the
 * partial-unique pair index, so counted sessions are still bounded by MAX_PAIRED_STYLISTS direct
 * pairs. Callers pass the stylists reached through a salon; everything else counts.
 */
export type SharedLimitSession = {
  readonly stylistAccountId: string | null;
  readonly isShared: boolean;
};

export const countSessionsTowardSharedLimit = (
  sessions: readonly SharedLimitSession[],
  salonStylistIds: ReadonlySet<string>
): number =>
  sessions.filter(
    s =>
      s.isShared &&
      (s.stylistAccountId === null || !salonStylistIds.has(s.stylistAccountId))
  ).length;

export const isSharedSessionLimitReached = (count: number): boolean =>
  count >= SESSION_CONTAINER_CONFIG.SESSION_MAX_ACTIVE_PER_CLIENT;
