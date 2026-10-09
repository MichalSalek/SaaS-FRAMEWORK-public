import { generateHmacToken, verifyHmacToken } from './hmac-token.utils';
import { TIME } from '@kernel/application/constants.config';

const SECRET_SUFFIX = 'delete-confirm';
const TTL_MS = TIME.MS_PER_DAY;
const DELETE_PURPOSE = 'delete';

type DecodedDeleteToken = {
  userId: string;
  // Per-user delete-confirm epoch bound into the token at mint time
  // (User.delete_confirm_version). Acts as a single-use / invalidation nonce —
  // confirm only applies when DB delete_confirm_version STILL equals this value.
  version: number;
  timestamp: number;
};

// DECISION (nie usuwaj tego komentarza):
// Token wiąże TRZY pola: [userId, 'delete', version]. `version` to bieżąca wartość
// User.delete_confirm_version w chwili żądania usunięcia (USER_REQUEST_DELETE).
// To monotoniczny per-user epoch (analog do currentEmail-binding w email-change.token,
// ale delete nie ma mutowalnego pola do związania, więc dedykowana kolumna Int).
// confirmDeleteSelf_IO atomowo sprawdza version === DB delete_confirm_version i
// inkrementuje ją przy udanym soft-delete; reactivateAccount_IO też inkrementuje.
// Dzięki temu (QA user-lifecycle-1, signal #2 reactivationUndoneByReplay):
//   - replay tego samego linku po udanym confirm → version już zużyta (++) → odrzucony,
//   - replay starego linku PO reaktywacji → version dawno ++ → odrzucony (brak re-killa),
//   - każdy świeży request->confirm w oknie 24h działa (mint czyta aktualną wersję).
export const createDeleteConfirmToken = (
  userId: string,
  version: number
): string => {
  return generateHmacToken(
    [userId, DELETE_PURPOSE, String(version)],
    SECRET_SUFFIX
  );
};

export const verifyDeleteConfirmToken = (
  token: string
): DecodedDeleteToken | null => {
  const result = verifyHmacToken(token, SECRET_SUFFIX, TTL_MS);
  // Require all 3 fields. Pre-version 2-field tokens are intentionally rejected —
  // they cannot be matched against delete_confirm_version (no single-use guarantee).
  // These age out within the 24h TTL; a soft-delete link is non-critical to lose.
  if (!result || result.parts.length !== 3) {
    return null;
  }

  const [userId, purpose, versionStr] = result.parts;
  if (!userId || purpose !== DELETE_PURPOSE || versionStr === undefined) {
    return null;
  }

  const version = Number(versionStr);
  if (!Number.isInteger(version) || version < 0) {
    return null;
  }

  return { userId, version, timestamp: result.timestamp };
};
