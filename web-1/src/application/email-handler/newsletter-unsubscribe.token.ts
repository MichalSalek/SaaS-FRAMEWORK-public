import { generateHmacToken, verifyHmacToken } from './hmac-token.utils';

// Suffix is independent from lifecycle-email unsubscribe so a single user can
// have different signing keys per channel; reduces blast radius if one leaks.
const SECRET_SUFFIX = 'newsletter-unsubscribe';

// No TTL: newsletter unsubscribe links in broadcast email footers must remain
// valid forever — recipients may unsubscribe weeks or months after delivery.

type DecodedNewsletterUnsubscribeToken = {
  email: string;
  timestamp: number;
};

const PURPOSE_MARKER = 'newsletter';

export const createNewsletterUnsubscribeToken = (email: string): string => {
  return generateHmacToken([email, PURPOSE_MARKER], SECRET_SUFFIX);
};

export const verifyNewsletterUnsubscribeToken = (
  token: string
): DecodedNewsletterUnsubscribeToken | null => {
  const result = verifyHmacToken(token, SECRET_SUFFIX);
  if (!result || result.parts.length < 2) {
    return null;
  }

  // Email may contain ':' theoretically? Email RFC allows '@' but not ':',
  // so it's safe to take part[0] as email and require purpose marker last.
  const email = result.parts[0];
  const purpose = result.parts[result.parts.length - 1];
  if (!email || purpose !== PURPOSE_MARKER) {
    return null;
  }

  return { email, timestamp: result.timestamp };
};
