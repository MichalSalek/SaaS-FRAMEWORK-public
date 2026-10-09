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

// DECISION (nie usuwaj tego komentarza):
// Token wiąże TRZY pola: [userId, currentEmail, newEmail]. currentEmail (email
// w chwili żądania zmiany) jest stateless'owym odpowiednikiem nonce/wersji —
// confirmEmailChange_IO stosuje zmianę TYLKO gdy bieżący email w DB === currentEmail.
// Dzięki temu, bez kolumny w schemacie:
//   - replay tego samego linku po zmianie → email już ≠ currentEmail → 4xx (nie nukuje sesji),
//   - stary link (A→X) po nowszej zmianie (A→Y) → email = Y ≠ A → 4xx (brak ghost-revert).
// Każda zmiana emaila unieważnia WSZYSTKIE wcześniej wydane tokeny wiązane do
// poprzedniej wartości. Pełna monotoniczna wersja (per-user token epoch w DB) =
// post-launch; tutaj wiązanie do currentEmail jest wystarczające i nie wymaga migracji.
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
