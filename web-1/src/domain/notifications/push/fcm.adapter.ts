import { createSign } from 'node:crypto';
import { TIME } from '@kernel/application/constants.config';
import { reportIssueBackend } from '@app/debugger/error-handler';
import {
  getFirebaseServiceAccount,
  type FirebaseServiceAccount,
} from './push.config';
import type { PushDeliveryOutcome, PushPayload } from './push-payload.types';

/**
 * FCM HTTP v1 without `firebase-admin`.
 *
 * DECISION:
 * The whole need is ONE authenticated POST per device. firebase-admin brings
 * the Firestore, Auth and Storage clients (tens of MB) for a token exchange that
 * is forty lines of standard OAuth 2.0 JWT bearer: sign a JWT with the service
 * account's RSA key, trade it for an access token, cache the token until it
 * nears expiry. `AbortSignal.timeout` bounds every call so a degraded Google
 * endpoint never stalls the event-bus handler.
 */
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_LIFETIME_S = 60 * 60;
const TOKEN_REFRESH_MARGIN_MS = 5 * TIME.MS_PER_MINUTE;
const HTTP_TIMEOUT_MS = 8_000;

type CachedToken = { value: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

const base64url = (input: string | Buffer): string =>
  Buffer.from(input).toString('base64url');

const signJwt = (
  account: FirebaseServiceAccount,
  nowSeconds: number
): string => {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: FCM_SCOPE,
      aud: account.token_uri,
      iat: nowSeconds,
      exp: nowSeconds + TOKEN_LIFETIME_S,
    })
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(account.private_key);
  return `${header}.${claims}.${base64url(signature)}`;
};

const getAccessToken = async (
  account: FirebaseServiceAccount
): Promise<string | null> => {
  if (
    cachedToken &&
    cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()
  ) {
    return cachedToken.value;
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const assertion = signJwt(account, nowSeconds);
  const response = await fetch(account.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!response.ok) {
    reportIssueBackend({
      namespace: 'FCM_TOKEN_FAILED',
      message: `FCM OAuth token request failed with ${response.status}`,
      payload: { status: response.status },
      mode: 'error',
    });
    return null;
  }
  const json = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) {
    return null;
  }
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? TOKEN_LIFETIME_S) * 1000,
  };
  return cachedToken.value;
};

export const isFcmConfigured = (): boolean =>
  getFirebaseServiceAccount() !== null;

export const sendFcmPush = async (
  token: string,
  payload: PushPayload
): Promise<PushDeliveryOutcome> => {
  const account = getFirebaseServiceAccount();
  if (!account) {
    return 'failed';
  }
  try {
    const accessToken = await getAccessToken(account);
    if (!accessToken) {
      return 'failed';
    }
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token,
            // `notification` lets Android show it while the app is in the
            // background; `data` is what the Capacitor plugin hands to the app
            // on tap (pushNotificationActionPerformed) and in the foreground.
            notification: { title: payload.title, body: payload.body },
            data: {
              url: payload.url,
              tag: payload.tag,
              notificationId: payload.notificationId,
            },
            android: {
              priority: 'HIGH',
              notification: { tag: payload.tag },
            },
          },
        }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      }
    );
    if (response.ok) {
      return 'sent';
    }
    const body = (await response.json().catch(() => null)) as {
      error?: { status?: string; details?: Array<{ errorCode?: string }> };
    } | null;
    const errorCode = body?.error?.details?.find(d => d.errorCode)?.errorCode;
    // DECISION: INVALID_ARGUMENT may describe a bad message, not an expired device.
    // Test: fcm.adapter.test.ts (keeps the subscription after a payload error).
    if (response.status === 404 || errorCode === 'UNREGISTERED') {
      return 'gone';
    }
    if (response.status === 401) {
      // The cached token is no longer accepted: forget it, the next send re-mints.
      cachedToken = null;
    }
    reportIssueBackend({
      namespace: 'FCM_SEND_FAILED',
      message: `FCM rejected the message with ${response.status}`,
      payload: { status: response.status, errorCode: errorCode ?? null },
      mode: 'warn',
    });
    return 'failed';
  } catch (error) {
    reportIssueBackend({
      namespace: 'FCM_SEND_FAILED',
      message: error instanceof Error ? error.message : 'FCM send failed',
      payload: null,
      mode: 'warn',
    });
    return 'failed';
  }
};
