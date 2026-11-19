// UI/features/stylist/hooks/useProfileBookmarkState.ts
// State of the „Polub stylistkę" bookmark on the public profile, extracted from
// the composition (max-lines 300). Encapsulates: the page-1 bookmark query,
// the bookmark/unbookmark mutations and the local knownBookmarked sync.
//
// A page-1 scan (take:20, newest) gives a FALSE NEGATIVE for a bookmark
// older than 20 entries (nobody calls fetchNextPage here): a „Zapisz" click
// then hits BOOKMARK_ALREADY_EXISTS. knownBookmarked syncs the state
// from the backend response (success OR already-exists = „it is saved"),
// so the button repairs itself after the first click.

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
  /** The page-1 query only with a CONFIRMED client_account. */
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

  // One mutation at a time: the button state changes only after the response,
  // so a quick second click sent a second request in the same direction (a second
  // bookmark ended in ALREADY_EXISTS, a second unbookmark in an error).
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
            // ALREADY_EXISTS = the „saved" state (bookmark beyond page 1):
            // sync the button instead of leaving a false negative.
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
