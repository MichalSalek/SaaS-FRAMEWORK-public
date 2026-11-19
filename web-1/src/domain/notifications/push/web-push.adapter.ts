import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { createPublicPushAgent } from '@app/http/public-push-agent';
import webpush, { WebPushError } from 'web-push';
import { NOTIFICATION_CONFIG } from '@kernel/domain/notifications/notification.config';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { getWebPushConfig, type WebPushVapidConfig } from './push.config';
import type { PushDeliveryOutcome, PushPayload } from './push-payload.types';

/**
 * Web Push (RFC 8030 + VAPID) through the `web-push` library: the payload is
 * encrypted with the subscription's own keys (aes128gcm), so only that browser
 * can read it. VAPID details are set once per process.
 */
let configured: WebPushVapidConfig | null | undefined;
const publicPushAgent = createPublicPushAgent();

const ensureConfigured = (): WebPushVapidConfig | null => {
  if (configured !== undefined) {
    return configured;
  }
  const config = getWebPushConfig();
  if (config) {
    webpush.setVapidDetails(
      config.subject,
      config.publicKey,
      config.privateKey
    );
  }
  configured = config;
  return config;
};

export const isWebPushConfigured = (): boolean => ensureConfigured() !== null;

export const sendWebPush = async (
  subscription: {
    endpoint: string;
    p256dh: string | null;
    auth: string | null;
  },
  payload: PushPayload
): Promise<PushDeliveryOutcome> => {
  if (!ensureConfigured()) {
    return 'failed';
  }
  if (!subscription.p256dh || !subscription.auth) {
    // Validated on registration; a row without keys is unreachable by design.
    return 'gone';
  }
  try {
    const endpoint = new URL(subscription.endpoint);
    if (
      endpoint.protocol !== 'https:' ||
      endpoint.username ||
      endpoint.password ||
      isIP(endpoint.hostname.replace(/^\[|\]$/g, '')) !== 0
    ) {
      return 'gone';
    }
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
      {
        TTL: NOTIFICATION_CONFIG.PUSH_TTL_SECONDS,
        urgency: 'normal',
        // One live notification per subject on the device (replaces the previous).
        topic: topicFromTag(payload.tag),
        agent: publicPushAgent,
      }
    );
    return 'sent';
  } catch (error) {
    if (error instanceof WebPushError) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        return 'gone';
      }
      reportIssueBackend({
        namespace: 'WEB_PUSH_SEND_FAILED',
        message: `Web push rejected with ${error.statusCode}`,
        payload: {
          statusCode: error.statusCode,
          body: error.body?.slice(0, 200),
        },
        mode: 'warn',
      });
      return 'failed';
    }
    reportIssueBackend({
      namespace: 'WEB_PUSH_SEND_FAILED',
      message: error instanceof Error ? error.message : 'web push failed',
      payload: null,
      mode: 'warn',
    });
    return 'failed';
  }
};

// RFC 8030 Topic: hash the whole logical key so distinct groups do not replace each other.
const topicFromTag = (tag: string): string =>
  createHash('sha256').update(tag).digest('base64url').slice(0, 32);
