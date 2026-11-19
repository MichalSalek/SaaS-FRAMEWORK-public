// UI/features/sessions/session-stylist-availability.ts
// Which connected stylists can still receive a NEW session from this client,
// and which already have an open one with her.
//
// DECISION: the database allows ONE open session per client and stylist (partial-unique
// `session_container_active_pair_uq`; a DRAFT counts). A stylist-less session gets its stylist with
// the first photo, so offering a stylist who already has an open session with her could only end in
// a refusal. Both the create dialog and the stylist chooser of a stylist-less session read this one
// mapping; such a stylist stays VISIBLE and her row leads into the session that is already open
// (house rule: an action that is not available is shown, never hidden).

import {
  isActiveSession,
  isTerminalSession,
} from '@kernel/domain/session-container/session-container.types';
import type { SessionContainerDTO } from '@kernel/models/session-container/session-container.dto';

export type OpenSessionRef = {
  id: string;
  /** Shared (SHARED/ACTIVE), i.e. counts towards the limit of shared sessions. */
  shared: boolean;
};

type SessionLike = Pick<
  SessionContainerDTO,
  'id' | 'stylistAccountId' | 'lifecycleState'
>;

/** stylistAccountId → her open session with this client (the first one in the
 *  given order wins). Terminal sessions and `excludeSessionId` are skipped. */
export function mapOpenSessionsByStylist(
  sessions: readonly SessionLike[],
  excludeSessionId?: string
): Map<string, OpenSessionRef> {
  const map = new Map<string, OpenSessionRef>();
  for (const s of sessions) {
    if (
      s.stylistAccountId === null ||
      s.id === excludeSessionId ||
      isTerminalSession(s.lifecycleState) ||
      map.has(s.stylistAccountId)
    ) {
      continue;
    }
    map.set(s.stylistAccountId, {
      id: s.id,
      shared: isActiveSession(s.lifecycleState),
    });
  }
  return map;
}

/** Splits stylists into those a session can go to and those that already have
 *  an open session with her (with that session's id), keeping the input order. */
export function splitStylistsByOpenSession<
  T extends { stylistAccountId: string },
>(
  stylists: readonly T[],
  openByStylist: ReadonlyMap<string, OpenSessionRef>
): {
  available: T[];
  withOpenSession: { stylist: T; sessionId: string }[];
} {
  const available: T[] = [];
  const withOpenSession: { stylist: T; sessionId: string }[] = [];
  for (const stylist of stylists) {
    const open = openByStylist.get(stylist.stylistAccountId);
    if (open) {
      withOpenSession.push({ stylist, sessionId: open.id });
    } else {
      available.push(stylist);
    }
  }
  return { available, withOpenSession };
}
