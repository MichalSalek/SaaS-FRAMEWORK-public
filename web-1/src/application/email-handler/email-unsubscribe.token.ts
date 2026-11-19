import {
  EMAIL_CATEGORY,
  type EmailCategory,
} from '@kernel/domain/email/email-schedule.config';
import { generateHmacToken, verifyHmacToken } from './hmac-token.utils';

const SECRET_SUFFIX = 'unsubscribe';

const VALID_CATEGORIES = new Set<string>(Object.values(EMAIL_CATEGORY));
const isEmailCategory = (value: string): value is EmailCategory =>
  VALID_CATEGORIES.has(value);

type DecodedToken = {
  userId: string;
  category: EmailCategory;
  timestamp: number;
};

export const generateUnsubscribeToken = (
  userId: string,
  category: EmailCategory
): string => {
  return generateHmacToken([userId, category], SECRET_SUFFIX);
};

export const verifyUnsubscribeToken = (token: string): DecodedToken | null => {
  const result = verifyHmacToken(token, SECRET_SUFFIX);
  if (!result || result.parts.length !== 2) {
    return null;
  }

  const [userId, category] = result.parts;
  if (!userId || !category || !isEmailCategory(category)) {
    return null;
  }

  return { userId, category, timestamp: result.timestamp };
};
