import crypto from 'crypto';
import { ENV_VARS } from '@app/environment/environment.config';

const ALGORITHM = 'sha256';
const SEPARATOR = ':';

const DEV_FALLBACK_SECRET =
  'dev-only-email-token-secret-do-not-use-in-production';

const getSecret = (suffix: string): string => {
  const base = ENV_VARS.EMAIL_UNSUBSCRIBE_SECRET;

  if (base) {
    return suffix ? `${base}-${suffix}` : base;
  }

  // DECISION (nie usuwaj tego komentarza): the fallback literal lives in the repository,
  // so it is allowed only where no outside client reaches the backend (DEVELOPMENT,
  // STAGING). Every other mode, PREVIEW included, must configure the secret or fail
  // closed: a token signed with a known literal can be forged by anyone who read it.
  if (
    ENV_VARS.NODE_ENV_MANUAL !== 'DEVELOPMENT' &&
    ENV_VARS.NODE_ENV_MANUAL !== 'STAGING'
  ) {
    throw new Error(
      'EMAIL_UNSUBSCRIBE_SECRET must be set outside development and staging'
    );
  }

  return `${DEV_FALLBACK_SECRET}-${suffix || 'default'}`;
};

const createSignature = (payload: string, secret: string): string => {
  return crypto
    .createHmac(ALGORITHM, secret)
    .update(payload)
    .digest('base64url');
};

export const generateHmacToken = (
  fields: string[],
  secretSuffix: string
): string => {
  const timestamp = Date.now();
  const payload = [...fields, String(timestamp)].join(SEPARATOR);
  const payloadBase64 = Buffer.from(payload).toString('base64url');
  const signature = createSignature(payload, getSecret(secretSuffix));
  return `${payloadBase64}.${signature}`;
};

type VerifiedPayload = {
  parts: string[];
  timestamp: number;
};

export const verifyHmacToken = (
  token: string,
  secretSuffix: string,
  ttlMs?: number
): VerifiedPayload | null => {
  try {
    const dotIndex = token.indexOf('.');
    if (dotIndex === -1) {
      return null;
    }

    const payloadBase64 = token.substring(0, dotIndex);
    const providedSignature = token.substring(dotIndex + 1);

    const payload = Buffer.from(payloadBase64, 'base64url').toString('utf-8');
    const parts = payload.split(SEPARATOR);
    if (parts.length < 2) {
      return null;
    }

    const timestampStr = parts[parts.length - 1];
    const timestamp = Number(timestampStr);
    if (isNaN(timestamp) || timestamp <= 0) {
      return null;
    }

    if (ttlMs != null) {
      const age = Date.now() - timestamp;
      if (age > ttlMs || age < 0) {
        return null;
      }
    }

    const secret = getSecret(secretSuffix);
    const expectedSignature = createSignature(payload, secret);

    const maxLen = Math.max(providedSignature.length, expectedSignature.length);
    const providedBuffer = Buffer.alloc(maxLen);
    const expectedBuffer = Buffer.alloc(maxLen);
    providedBuffer.write(providedSignature, 'utf-8');
    expectedBuffer.write(expectedSignature, 'utf-8');

    if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
      return null;
    }

    return { parts: parts.slice(0, -1), timestamp };
  } catch {
    return null;
  }
};
