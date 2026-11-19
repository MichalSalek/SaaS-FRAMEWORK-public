import { Resend } from 'resend';
import { ENV_VARS } from '@app/environment/environment.config';
import { reportIssueBackend } from '@app/debugger/error-handler';

/**
 * Syncs confirmed newsletter subscribers to the Resend broadcast list.
 * DECISION: own client on `RESEND_MARKETING_API_KEY` (a full key). The transactional client
 * is send-only and gets 401 on contacts. Sync never throws: the database is the consent
 * record, and a Resend outage must not block confirm or unsubscribe. Both calls run in
 * `runAfterResponse` with an internal timeout. There is no reconcile sweep.
 */

// Lazy singleton (parity with the Resend/Mailgun adapters). Created once when the key is present.
let _marketingClient: Resend | null = null;

// Hard timeout: the Resend SDK contacts.* makes a bare fetch with no built-in timeout. Without it
// a hung Resend would hold the confirm/unsubscribe operation (and its worker) past a sane window.
// 8s = the same floor as the transactional adapter.
const AUDIENCE_SYNC_TIMEOUT_MS = 8000;

type AudienceConfig = { client: Resend; audienceId: string };

/**
 * Resolves the audience configuration. Feature-flagged BY PRESENCE (a pair): both env vars set =
 * active. Either missing = null and the caller no-ops (the newsletter keeps working, just without
 * the sync to the broadcast list).
 */
const resolveAudienceConfig = (): AudienceConfig | null => {
  // Staging consent stays in its own database and must never touch a live audience.
  if (ENV_VARS.NODE_ENV_MANUAL === 'STAGING') {
    return null;
  }
  const apiKey = ENV_VARS.RESEND_MARKETING_API_KEY;
  const audienceId = ENV_VARS.RESEND_AUDIENCE_ID;
  if (!apiKey || !audienceId) {
    return null;
  }
  if (!_marketingClient) {
    _marketingClient = new Resend(apiKey);
  }
  return { client: _marketingClient, audienceId };
};

/**
 * Owija obietnicę SDK w wyścig z timeoutem, sprzątając timer w finally (wygrany
 * SDK nie zostawia wiszącego setTimeout blokującego event-loop).
 */
const withTimeout = async <T>(op: Promise<T>, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`${label} timeout after ${AUDIENCE_SYNC_TIMEOUT_MS}ms`)
        ),
      AUDIENCE_SYNC_TIMEOUT_MS
    );
  });
  try {
    return await Promise.race([op, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

/**
 * Adds a confirmed subscriber to the Resend Audience (email only: `NewsletterSubscriber` holds no
 * name). Called from `newsletterConfirm_IO` AFTER a successful double opt-in (`unsubscribed: false`).
 *
 * DECISION: Resend's `contacts.create` behaves as an UPSERT by email within the audience (observed
 * against the live API: a repeated create returns the same id, and a create with
 * `unsubscribed:false` on a previously UNSUBSCRIBED contact flips the flag back). One `create`
 * therefore covers a fresh signup and re-subscription. This is vendor behaviour no repo test pins
 * (the adapter test mocks the SDK). Never throws (report and swallow, DB is the consent SSOT).
 */
export const addConfirmedSubscriberToAudience = async (
  email: string
): Promise<void> => {
  const config = resolveAudienceConfig();
  if (!config) {
    return; // feature flag off: the DB stays the SSOT, no broadcast sync
  }
  const { client, audienceId } = config;

  try {
    const { error } = await withTimeout(
      client.contacts.create({ audienceId, email, unsubscribed: false }),
      'resend audience create'
    );
    if (error) {
      reportIssueBackend({
        namespace: 'RESEND_AUDIENCE_SYNC',
        message: 'Failed to add confirmed subscriber to Resend audience',
        payload: { error },
        mode: 'error',
      });
    }
  } catch (error) {
    // Timeout / błąd sieciowy — best-effort, połknij (DB = SSOT zgody).
    reportIssueBackend({
      namespace: 'RESEND_AUDIENCE_SYNC',
      message: 'Resend audience add threw (timeout/network)',
      payload: {
        error: error instanceof Error ? error.message : String(error),
      },
      mode: 'error',
    });
  }
};

/**
 * Marks the contact as unsubscribed in the Resend Audience (`unsubscribed: true`); called from
 * `newsletterUnsubscribe_IO` after the consent withdrawal is stored in the DB. `update` over
 * `remove`: a suppressed contact (Resend will not broadcast to it nor re-add it in bulk) is safer
 * than a removed one, which could come back on the list and get mail. A contact absent from the
 * list (never synced / pending) makes update return an error; we report it as `warn` (nothing to
 * do) and swallow it. NEVER throws.
 */
export const markSubscriberUnsubscribedInAudience = async (
  email: string
): Promise<void> => {
  const config = resolveAudienceConfig();
  if (!config) {
    return; // feature-flag off — brak syncu broadcastowego
  }
  const { client, audienceId } = config;

  try {
    const { error } = await withTimeout(
      client.contacts.update({ audienceId, email, unsubscribed: true }),
      'resend audience unsubscribe'
    );
    if (error) {
      reportIssueBackend({
        namespace: 'RESEND_AUDIENCE_SYNC',
        message: 'Failed to mark subscriber unsubscribed in Resend audience',
        payload: { error },
        mode: 'warn',
      });
    }
  } catch (error) {
    reportIssueBackend({
      namespace: 'RESEND_AUDIENCE_SYNC',
      message: 'Resend audience unsubscribe threw (timeout/network)',
      payload: {
        error: error instanceof Error ? error.message : String(error),
      },
      mode: 'warn',
    });
  }
};

/**
 * Test-only reset of the lazy singleton (parity with the other adapters). Do not use in
 * production.
 */
export const __resetResendAudienceClientForTest = (): void => {
  _marketingClient = null;
};
