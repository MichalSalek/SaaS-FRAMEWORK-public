// UI/features/sessions/hooks/useSessionStylistName.ts
// The name of the stylist a client's session is for, resolved from her list
// of connected stylists (the session itself carries only the account id).

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import type { SessionContainerDetailDTO } from '@kernel/models/session-container/session-container.dto';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { useQuery } from '@tanstack/react-query';
import { usePairedStylists } from '../../shared/pairing/hooks/usePairedStylists';
import { profileQueryOptions } from '../../stylist/StylistProfilePage.query';

export function useSessionStylistName(
  session: SessionContainerDetailDTO | undefined
) {
  const t = useTranslations('pages.sessions');
  const tPairing = useTranslations('pages.pairing');
  const {
    pairs,
    isError: pairsError,
    hasData: pairsHasData,
  } = usePairedStylists();

  /* Resolve stylist display name from paired list — client view's
   * SessionContainerDetailDTO carries only `stylistAccountId`.
   * DECISION: when the paired-stylists query fails (pairsError) or the pair is gone (unpaired after
   * the session), the name cannot be resolved, so the credit falls back to the generic
   * `labels.stylistFallback`, the SAME fallback the Conclusion card uses, so one screen never shows
   * two names for one state. That degraded credit is NOT the same as the session genuinely having
   * no stylist (stylistAccountId null -> "Bez stylistki"). Without surfacing pairsError the user
   * would silently see a generic credit and assume it is correct, so the effect below raises a
   * non-blocking snackbar (the rest of the session renders regardless). */
  const stylistPair =
    session?.stylistAccountId !== null &&
    session?.stylistAccountId !== undefined
      ? pairs.find(p => p.stylistAccountId === session.stylistAccountId)
      : undefined;
  const stylistDisplayName =
    session?.stylistAccountId === null ||
    session?.stylistAccountId === undefined
      ? null
      : stylistPair?.isInactive
        ? tPairing('inactiveAccount')
        : stylistPair?.stylistDisplayName || null;
  const stylistRecipientName =
    stylistPair && !stylistPair.isInactive
      ? stylistPair.stylistDisplayName || null
      : null;
  const stylistMessagePairId =
    stylistPair && !stylistPair.isInactive ? stylistPair.pairId : undefined;
  const stylistAccountId = session?.stylistAccountId ?? null;
  // The public profile is the one place that carries the stylist's contact
  // phone and avatar. It is already cached by the profile screen; a session
  // detail only asks when it has an account id. A failed read leaves the
  // phone out and does not block the session. (owner)
  const profile = useQuery({
    ...profileQueryOptions(stylistAccountId ?? ''),
    enabled: stylistAccountId !== null,
  });
  const stylistPhone = profile.data?.account.phone?.trim() || null;
  const stylistAvatarUrl =
    stylistPair?.avatarUrl ?? profile.data?.account.avatar_url ?? null;

  // Surface a pairs-fetch failure only when this session actually has a
  // stylist whose name we just failed to resolve — otherwise the toast would
  // be misleading for a stylist-less session. A failed background refetch
  // with the list still cached resolves the name fine, so it stays silent;
  // a cached list WITHOUT this stylist (e.g. empty) under a failed refetch
  // did not resolve it, so that case is surfaced too.
  const pairsUnresolved =
    pairsError &&
    (!pairsHasData ||
      !pairs.some(p => p.stylistAccountId === session?.stylistAccountId));
  useEffect(() => {
    if (pairsUnresolved && session?.stylistAccountId) {
      pushNewSnackbar(t('pairsStylistLoadError'), 'error');
    }
  }, [pairsUnresolved, session?.stylistAccountId, t]);

  return {
    pairs,
    stylistDisplayName,
    stylistRecipientName,
    stylistMessagePairId,
    stylistPhone,
    stylistAvatarUrl,
  };
}
