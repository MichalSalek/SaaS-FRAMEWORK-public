// Favorite and bookmark errors (kernel `FavoriteError`). Bookmarks have no limit; the limit lives
// on pairing.
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { FavoriteError } from '@kernel/domain/favorites/favorite-errors.types';
import { respondBadRequest, respondNotFound } from '../http.responses.utils';
import type { ErrorResponderMap, OwnErrors } from './error-map.types';

export const favoriteErrorMap = {
  BOOKMARK_ALREADY_EXISTS: (res, error) =>
    // SECURITY: do not echo clientUserId (caller's own session id, no enumeration value)
    respondBadRequest(
      res,
      APP_EVENTS.INFO.FAVORITE.STYLIST_ALREADY_BOOKMARKED,
      {
        stylistAccountId: error.stylistAccountId,
      }
    ),

  RECORD_ALREADY_IN_FAVORITES: (res, error) =>
    // SECURITY: do not echo userId (caller's own session id, no enumeration value)
    respondBadRequest(
      res,
      APP_EVENTS.INFO.FAVORITE.RECORD_ALREADY_IN_FAVORITES,
      { recordId: error.recordId }
    ),

  RECORD_NOT_IN_FAVORITES: (res, error) =>
    // SECURITY: do not echo userId (caller's own session id, no enumeration value)
    respondNotFound(res, APP_EVENTS.INFO.FAVORITE.RECORD_NOT_IN_FAVORITES, {
      recordId: error.recordId,
    }),

  RECORD_TO_ADD_NOT_FOUND: (res, error) =>
    // favorites-bookmarks-3: add-path not-found/access-deny. Same 404 + IDOR masking as the gallery
    // GET case, but with the FAVORITE ADD event (correct domain + verb in the event log).
    respondNotFound(
      res,
      APP_EVENTS.INFO.FAVORITE.CANNOT_ADD_RECORD_TO_FAVORITES,
      { recordId: error.recordId }
    ),
} satisfies ErrorResponderMap<OwnErrors<FavoriteError>>;
