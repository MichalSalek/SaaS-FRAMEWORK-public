// UI/features/stylist/hooks/useProfileBookmarkState.ts
// Stan zakładki „Polub stylistkę" na publicznym profilu — wydzielone z
// composition (max-lines 300, S82). Enkapsuluje: query strony 1 zakładek,
// mutacje bookmark/unbookmark i lokalną synchronizację knownBookmarked.
//
// S82: skan strony 1 (take:20, najnowsze) daje FAŁSZYWY NEGATYW dla zakładki
// starszej niż 20 pozycji (nikt tu nie woła fetchNextPage) — klik „Zapisz"
// wtedy leci w BOOKMARK_ALREADY_EXISTS. knownBookmarked synchronizuje stan
// z odpowiedzi backendu (success LUB already-exists = „jest zapisana"),
// więc przycisk sam się naprawia po pierwszym kliku.

import { useEffect, useState } from 'react';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { isIOError } from '../../../../application/http/io';
import {
  useBookmarkedStylists,
  flattenBookmarkedPages,
} from '../../shared/favorites/hooks/useBookmarkedStylists';
import { useBookmarkStylist } from '../../shared/favorites/hooks/useBookmarkStylist';
import { useUnbookmarkStylist } from '../../shared/favorites/hooks/useUnbookmarkStylist';

export function useProfileBookmarkState(params: {
  identifier: string;
  stylistAccountId: string | null;
  /** Query strony 1 tylko przy POTWIERDZONYM client_account (klasa S76). */
  hasClientAccount: boolean;
}) {
  const { identifier, stylistAccountId, hasClientAccount } = params;
  const bookmarkedStylistsQuery = useBookmarkedStylists(hasClientAccount);
  const bookmarkMutation = useBookmarkStylist();
  const unbookmarkMutation = useUnbookmarkStylist();

  const [knownBookmarked, setKnownBookmarked] = useState<boolean | null>(null);
  useEffect(() => {
    setKnownBookmarked(null);
  }, [identifier]);

  const isBookmarked =
    knownBookmarked ??
    (stylistAccountId == null || !bookmarkedStylistsQuery.data
      ? false
      : flattenBookmarkedPages(bookmarkedStylistsQuery.data).some(
          s => s.stylist_account_id === stylistAccountId
        ));

  // Jedna mutacja naraz: stan przycisku zmienia się dopiero po odpowiedzi,
  // więc szybki drugi klik wysyłał drugi request w tym samym kierunku (drugi
  // bookmark kończył się ALREADY_EXISTS, drugi unbookmark błędem).
  const isPending = bookmarkMutation.isPending || unbookmarkMutation.isPending;

  const toggle = () => {
    if (stylistAccountId == null || isPending) {
      return;
    }
    if (isBookmarked) {
      unbookmarkMutation.mutate(
        { stylist_account_id: stylistAccountId },
        { onSuccess: () => setKnownBookmarked(false) }
      );
    } else {
      bookmarkMutation.mutate(
        { stylist_account_id: stylistAccountId },
        {
          onSuccess: () => setKnownBookmarked(true),
          onError: err => {
            // ALREADY_EXISTS = stan „zapisana" (zakładka poza stroną 1) —
            // synchronizuj przycisk zamiast zostawiać fałszywy negatyw.
            if (
              isIOError(err) &&
              err.httpError.event ===
                APP_EVENTS.INFO.FAVORITE.STYLIST_ALREADY_BOOKMARKED
            ) {
              setKnownBookmarked(true);
            }
          },
        }
      );
    }
  };

  return { isBookmarked, toggle, isPending };
}
