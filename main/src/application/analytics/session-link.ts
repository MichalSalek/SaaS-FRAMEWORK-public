// application/analytics/session-link.ts
//
// DECISION: one visit must be findable in every tool from one record (owner).
// PostHog's session id is the key:
//  - Clarity gets it through its documented API: `identify(customId, customSessionId)` and a
//    `ph_session_id` tag, so a recording can be filtered by the PostHog session.
//  - PostHog gets Clarity's ids back through `clarity('metadata', cb)`, which clarity.js implements
//    but Microsoft does not document. If that changes the callback simply never fires and nothing
//    breaks; while it works every PostHog event carries `clarity_session_id` and `clarity_user_id`.
// It runs on every page view: PostHog rotates the session after 30 minutes of inactivity and
// Clarity asks for identify on each page.

import type { PostHog } from 'posthog-js';
import { clarity } from './analytics-sinks';
import { useCookieConsentStore } from '../stores/cookieConsent.store';

interface ClarityMetadata {
  projectId?: unknown;
  userId?: unknown;
  sessionId?: unknown;
}

const asId = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** The three calls the link needs; both the singleton and the instance handed
 *  to `loaded` satisfy it. */
type LinkablePostHog = Pick<
  PostHog,
  'get_session_id' | 'get_distinct_id' | 'register'
>;

export function linkAnalyticsSessions(posthog: LinkablePostHog): void {
  // A refused analytics consent keeps Clarity cookieless: tying its recording
  // to a person's id would undo exactly what she refused.
  if (useCookieConsentStore.getState().consent?.analytics === false) {
    return;
  }
  let sessionId: string;
  let distinctId: string;
  try {
    sessionId = posthog.get_session_id();
    distinctId = posthog.get_distinct_id();
  } catch {
    return;
  }
  if (sessionId === '' || distinctId === '') {
    return;
  }
  clarity('identify', distinctId, sessionId);
  clarity('set', 'ph_session_id', sessionId);
  clarity(
    'metadata',
    (meta: ClarityMetadata | undefined) => {
      const clarityProjectId = asId(meta?.projectId);
      const clarityUserId = asId(meta?.userId);
      const claritySessionId = asId(meta?.sessionId);
      if (clarityUserId === undefined || claritySessionId === undefined) {
        return;
      }
      try {
        posthog.register({
          clarity_project_id: clarityProjectId,
          clarity_user_id: clarityUserId,
          clarity_session_id: claritySessionId,
        });
      } catch {
        // Linking is best-effort; it must never interrupt the page.
      }
    },
    false,
    true,
    true
  );
}
