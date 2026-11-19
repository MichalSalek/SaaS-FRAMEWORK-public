export type BookmarkAlreadyExistsError = {
  type: 'BOOKMARK_ALREADY_EXISTS';
  stylistAccountId: string;
  clientUserId: string;
};

export type RecordAlreadyInFavoritesError = {
  type: 'RECORD_ALREADY_IN_FAVORITES';
  recordId: string;
  userId: string;
};

export type RecordNotInFavoritesError = {
  type: 'RECORD_NOT_IN_FAVORITES';
  recordId: string;
  userId: string;
};

// Add-path "record not found / inaccessible" — semantically distinct from the
// gallery GET error GALLERY_RECORD_NOT_FOUND. Maps to a 404 with the FAVORITE
// ADD event (CANNOT_ADD_RECORD_TO_FAVORITES) instead of the misleading
// gallery-GET event. Access denial is intentionally masked as not-found (IDOR).
export type RecordToAddNotFoundError = {
  type: 'RECORD_TO_ADD_NOT_FOUND';
  recordId: string;
};

export type FavoriteError =
  | BookmarkAlreadyExistsError
  | RecordAlreadyInFavoritesError
  | RecordNotInFavoritesError
  | RecordToAddNotFoundError;
