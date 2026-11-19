/**
 * Push opt-in status and the VAPID key conversion (pure parts of the client).
 */
import { describe, expect, it } from 'vitest';
import {
  readSubscriptionFields,
  resolvePushOptInStatus,
  urlBase64ToUint8Array,
} from './push.state';

describe('resolvePushOptInStatus', () => {
  it('is unsupported without push or without a key, whatever the permission', () => {
    expect(
      resolvePushOptInStatus({
        supported: false,
        permission: 'granted',
        subscribed: true,
      })
    ).toBe('unsupported');
  });

  it('denied wins over everything else', () => {
    expect(
      resolvePushOptInStatus({
        supported: true,
        permission: 'denied',
        subscribed: true,
      })
    ).toBe('denied');
  });

  it('on only with a granted permission AND a live subscription', () => {
    expect(
      resolvePushOptInStatus({
        supported: true,
        permission: 'granted',
        subscribed: true,
      })
    ).toBe('on');
    expect(
      resolvePushOptInStatus({
        supported: true,
        permission: 'granted',
        subscribed: false,
      })
    ).toBe('off');
    expect(
      resolvePushOptInStatus({
        supported: true,
        permission: 'default',
        subscribed: false,
      })
    ).toBe('off');
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodes a URL-safe base64 key into bytes', () => {
    // "hello" in URL-safe base64 without padding.
    const bytes = urlBase64ToUint8Array('aGVsbG8');
    expect(Array.from(bytes)).toEqual([104, 101, 108, 108, 111]);
  });
});

describe('readSubscriptionFields', () => {
  it('needs both keys', () => {
    expect(
      readSubscriptionFields({
        endpoint: 'https://push.example/x',
        toJSON: () => ({ keys: { p256dh: 'p', auth: 'a' } }),
      })
    ).toEqual({ endpoint: 'https://push.example/x', p256dh: 'p', auth: 'a' });
    expect(
      readSubscriptionFields({
        endpoint: 'https://push.example/x',
        toJSON: () => ({ keys: { p256dh: 'p' } }),
      })
    ).toBeNull();
  });
});
