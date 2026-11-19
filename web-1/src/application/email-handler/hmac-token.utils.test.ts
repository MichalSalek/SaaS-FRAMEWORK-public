/**
 * The development fallback secret is a literal in the repository. It may sign tokens
 * only in DEVELOPMENT and STAGING; every other mode without EMAIL_UNSUBSCRIBE_SECRET
 * has to fail closed, because a token signed with a known literal can be forged.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const env = vi.hoisted(() => ({
  NODE_ENV_MANUAL: 'DEVELOPMENT',
  EMAIL_UNSUBSCRIBE_SECRET: '',
}));

vi.mock('@app/environment/environment.config', () => ({
  ENV_VARS: env,
}));

import {
  generateHmacToken,
  verifyHmacToken,
} from '@app/email-handler/hmac-token.utils';

describe('hmac-token.utils: fallback secret gate', () => {
  beforeEach(() => {
    env.NODE_ENV_MANUAL = 'DEVELOPMENT';
    env.EMAIL_UNSUBSCRIBE_SECRET = '';
  });

  it.each(['DEVELOPMENT', 'STAGING'])('signs with the fallback in %s', mode => {
    env.NODE_ENV_MANUAL = mode;
    const token = generateHmacToken(['user-1'], 'delete');
    expect(verifyHmacToken(token, 'delete')?.parts).toEqual(['user-1']);
  });

  it.each(['PRODUCTION', 'PREVIEW', ''])(
    'refuses to sign without a configured secret in "%s"',
    mode => {
      env.NODE_ENV_MANUAL = mode;
      expect(() => generateHmacToken(['user-1'], 'delete')).toThrow(
        /EMAIL_UNSUBSCRIBE_SECRET/
      );
    }
  );

  it('a token signed with a configured secret does not verify against the fallback', () => {
    env.NODE_ENV_MANUAL = 'PREVIEW';
    env.EMAIL_UNSUBSCRIBE_SECRET = 'configured-secret';
    const token = generateHmacToken(['user-1'], 'delete');
    expect(verifyHmacToken(token, 'delete')?.parts).toEqual(['user-1']);

    env.NODE_ENV_MANUAL = 'DEVELOPMENT';
    env.EMAIL_UNSUBSCRIBE_SECRET = '';
    expect(verifyHmacToken(token, 'delete')).toBeNull();
  });
});
