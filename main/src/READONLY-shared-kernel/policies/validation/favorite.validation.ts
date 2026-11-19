import { FAVORITE_CONTRACTS } from '../../domain/favorites/favorite.contracts';
import { contractBodyValidator } from './contract.validation';
import { NO_VALIDATION } from './validation.types';

// DECISION: the favorites request schemas live in their API contracts
// (`domain/favorites/favorite.contracts.ts`), and the handlers bind them through `defineEndpoint`.
// These named validators stay as the legacy view of the same schemas (VALIDATION_POLICY consumers,
// form reuse); there is no second schema to drift, so the per-domain DTO witness types are gone.
const C = FAVORITE_CONTRACTS;

export const favoriteValidators = {
  bookmarkStylist: contractBodyValidator(C.BOOKMARK_STYLIST.body),
  unbookmarkStylist: contractBodyValidator(C.UNBOOKMARK_STYLIST.body),
  // bodyless GET (cursor/take arrive in the query string, decoded by the contract's query fields).
  getBookmarkedStylists: NO_VALIDATION,
  favoriteAddRecord: contractBodyValidator(C.FAVORITE_ADD_RECORD.body),
  favoriteRemoveRecord: contractBodyValidator(C.FAVORITE_REMOVE_RECORD.body),
  // bodyless GET (cursor/take arrive in the query string, decoded by the contract's query fields).
  favoriteGetRecords: NO_VALIDATION,
  favoriteUpdateRecordNote: contractBodyValidator(
    C.FAVORITE_UPDATE_RECORD_NOTE.body
  ),
  // bodyless GET (no request fields).
  favoriteGetGrouped: NO_VALIDATION,
} as const;
