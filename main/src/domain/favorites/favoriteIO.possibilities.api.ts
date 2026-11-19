import { contractEndpoint } from '../../application/http/io';
import { FAVORITE_CONTRACTS } from '@kernel/domain/favorites/favorite.contracts';

// Single-contract pilot: every favorites call is derived from its kernel contract (URL, method,
// request and response types). The `_IO` names are kept for the existing hooks.
const C = FAVORITE_CONTRACTS;

export const bookmarkStylist_IO = contractEndpoint(C.BOOKMARK_STYLIST);
export const unbookmarkStylist_IO = contractEndpoint(C.UNBOOKMARK_STYLIST);
export const getBookmarkedStylists_IO = contractEndpoint(
  C.GET_BOOKMARKED_STYLISTS
);
export const addRecordToFavorites_IO = contractEndpoint(C.FAVORITE_ADD_RECORD);
export const removeRecordFromFavorites_IO = contractEndpoint(
  C.FAVORITE_REMOVE_RECORD
);
export const getFavoriteRecords_IO = contractEndpoint(C.FAVORITE_GET_RECORDS);
export const updateFavoriteRecordNote_IO = contractEndpoint(
  C.FAVORITE_UPDATE_RECORD_NOTE
);
export const getFavoriteGrouped_IO = contractEndpoint(C.FAVORITE_GET_GROUPED);
