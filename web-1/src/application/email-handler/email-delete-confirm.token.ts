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

// DECISION: the token binds [userId, 'delete', version], where version is
// User.delete_confirm_version at request time (USER_REQUEST_DELETE). It is a monotonic per-user
// epoch (delete has no mutable field to bind, unlike email-change). confirmDeleteSelf_IO checks
// version === DB value atomically and increments it on a successful soft-delete;
// reactivateAccount_IO increments too. So a replayed link after confirm, or an old link after
// reactivation, is rejected, while every fresh request->confirm within 24h works.
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
