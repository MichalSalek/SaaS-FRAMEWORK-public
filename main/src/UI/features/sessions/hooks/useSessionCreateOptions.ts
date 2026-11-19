// UI/features/sessions/hooks/useSessionCreateOptions.ts
// What „Utwórz sesję” can offer: the connected stylists as modal options,
// whether the limit of shared sessions is reached, and the one stylist for
// whom the session can be created without asking.

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { SESSION_CONTAINER_CONFIG } from '@kernel/domain/session-container/session-container.config';
import {
  countSessionsTowardSharedLimit,
  isSharedSessionLimitReached,
} from '@kernel/domain/session-container/session-container.limit';
import { isActiveSession } from '@kernel/domain/session-container/session-container.types';
import { mapOpenSessionsByStylist } from '../session-stylist-availability';
import type { SessionContainerDTO } from '@kernel/models/session-container/session-container.dto';
import {
  resolveStylistsStatus,
  type StylistOption,
  type StylistsStatus,
} from '../../../components/CreateSessionModal/CreateSessionModal.organism';
import type { usePairedStylists } from '../../shared/pairing/hooks/usePairedStylists';

const SHARED_LIMIT = SESSION_CONTAINER_CONFIG.SESSION_MAX_ACTIVE_PER_CLIENT;

export function useSessionCreateOptions(
  /** The client's open (non-terminal) sessions. */
  openSessions: readonly SessionContainerDTO[],
  pairedStylists: ReturnType<typeof usePairedStylists>
) {
  const tPairing = useTranslations('pages.pairing');
  const tLabels = useTranslations('labels');
  const { pairs } = pairedStylists;
  // The modal must tell „pairs unknown" from „no pairs": an empty `pairs` on a
  // failed or pending fetch used to render „no paired stylists, pair anew".
  const stylistsStatus: StylistsStatus = resolveStylistsStatus(pairedStylists);

  // stylistAccountId → the open session with her, so a row can lead INTO that
  // session; `shared` says whether it counts towards the limit below.
  const sessionByStylist = useMemo(
    () => mapOpenSessionsByStylist(openSessions),
    [openSessions]
  );

  const stylistOptions: StylistOption[] = useMemo(
    () =>
      pairs.map(p => ({
        id: p.stylistAccountId,
        // `||`: a stylist onboarded with the role alone has an empty name.
        name: p.isInactive
          ? tPairing('inactiveAccount')
          : p.stylistDisplayName || tLabels('stylistFallback'),
        businessName: null,
        avatarUrl: p.avatarUrl ?? null,
        hasActiveSession: sessionByStylist.has(p.stylistAccountId),
        activeSessionId: sessionByStylist.get(p.stylistAccountId)?.id ?? null,
        activeSessionShared:
          sessionByStylist.get(p.stylistAccountId)?.shared ?? false,
        outsideLimit: p.viaSalon,
      })),
    [pairs, sessionByStylist, tPairing, tLabels]
  );

  // The backend refuses a new session once this many are shared at the same
  // time. The modal then says so and leads into the sessions that can be
  // closed; before, she picked a stylist and only got the limit error back.
  // Sessions with stylists reached through a salon take no slot (kernel rule).
  const salonStylistIds = useMemo(
    () => new Set(pairs.filter(p => p.viaSalon).map(p => p.stylistAccountId)),
    [pairs]
  );
  const sharedLimitReached = isSharedSessionLimitReached(
    countSessionsTowardSharedLimit(
      openSessions.map(s => ({
        stylistAccountId: s.stylistAccountId,
        isShared: isActiveSession(s.lifecycleState),
      })),
      salonStylistIds
    )
  )
    ? SHARED_LIMIT
    : undefined;

  // One connected stylist and no open session with her: there is nothing to
  // choose, so the button creates the session directly (the chooser with a
  // single row was a step that asked what the app already knew).
  const only = stylistOptions[0];
  const onlyStylist =
    stylistsStatus === 'ready' &&
    stylistOptions.length === 1 &&
    only !== undefined &&
    !only.hasActiveSession &&
    (sharedLimitReached === undefined || only.outsideLimit === true)
      ? only
      : null;

  return { stylistsStatus, stylistOptions, sharedLimitReached, onlyStylist };
}
