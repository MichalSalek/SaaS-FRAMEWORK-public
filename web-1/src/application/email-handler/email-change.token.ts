import { generateHmacToken, verifyHmacToken } from './hmac-token.utils';
import { TIME } from '@kernel/application/constants.config';

const SECRET_SUFFIX = 'email-change';
const TTL_MS = TIME.MS_PER_DAY;

type DecodedEmailChangeToken = {
  userId: string;
  // Email the account had AT REQUEST TIME (bound into the token). Acts as a
  // stateless single-use nonce: confirm only applies if the DB email STILL
  // equals this value.
  currentEmail: string;
  newEmail: string;
  timestamp: number;
};

// DECISION: the token binds [userId, currentEmail, newEmail]. currentEmail is a stateless
// stand-in for a nonce/version: confirmEmailChange_IO applies the change only while the email in
// the DB still equals currentEmail. So a replayed link after the change (email != currentEmail)
// and an old A->X link after a newer A->Y change both fail with 4xx, with no schema column.
// A per-user token epoch in the DB would be fully monotonic but needs a migration; not needed.
export const createEmailChangeToken = (
  userId: string,
  currentEmail: string,
  newEmail: string
): string => {
  return generateHmacToken([userId, currentEmail, newEmail], SECRET_SUFFIX);
};

export const verifyEmailChangeToken = (
  token: string
): DecodedEmailChangeToken | null => {
  const result = verifyHmacToken(token, SECRET_SUFFIX, TTL_MS);
  if (!result || result.parts.length < 3) {
    return null;
  }

  // 3-field token: [userId, currentEmail, newEmail].
  const userId = result.parts[0];
  const currentEmail = result.parts[1];
  // newEmail rejoined defensively — an email cannot contain ':' but the HMAC
  // separator does, so anything past index 1 belongs to newEmail.
  const newEmail = result.parts.slice(2).join(':');
  if (!userId || !currentEmail || !newEmail) {
    return null;
  }
  return { userId, currentEmail, newEmail, timestamp: result.timestamp };
};
