import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendFcmPush } from './fcm.adapter';

vi.mock('./push.config', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const private_key = privateKey.export({ type: 'pkcs8', format: 'pem' });
  return {
    getFirebaseServiceAccount: () => ({
      project_id: 'test',
      client_email: 'test@example.test',
      private_key,
      token_uri: 'https://token.example.test',
    }),
  };
});

afterEach(() => vi.unstubAllGlobals());

const payload = {
  title: 'News',
  body: 'News',
  url: '/app/notifications',
  tag: 'ANNOUNCEMENT:test',
  notificationId: 'test',
};

describe('FCM error ownership', () => {
  it('keeps a valid device when the message itself is rejected as INVALID_ARGUMENT', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === 'https://token.example.test'
          ? new Response(
              JSON.stringify({ access_token: 'test', expires_in: 3600 }),
              { status: 200 }
            )
          : new Response(
              JSON.stringify({
                error: {
                  status: 'INVALID_ARGUMENT',
                  details: [
                    { '@type': 'type.googleapis.com/google.rpc.BadRequest' },
                  ],
                },
              }),
              { status: 400 }
            )
      )
    );
    expect(await sendFcmPush('test-device-token', payload)).toBe('failed');
  });
  it('removes a confirmed unregistered device', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { details: [{ errorCode: 'UNREGISTERED' }] },
            }),
            { status: 404 }
          )
      )
    );
    expect(await sendFcmPush('gone-device-token', payload)).toBe('gone');
  });
});
