import { useEffect, useRef } from 'react';
import posthog from 'posthog-js';
import { authClient } from '../auth/better-auth-client';
import { getSessionRoleId } from '../auth/session-fields.helpers';
import { useCookieConsentStore } from '../stores/cookieConsent.store';
import { isPosthogConfigured } from './analytics.config';

/**
 * Links the Better Auth session to PostHog `distinct_id` so browser events
 * stitch to backend `captureBackendEvent` (keyed on userId).
 *
 * Mount only inside `AuthProviderComposition` (same constraint as
 * `useAppRole` / `useSessionRole` — NOT in `AppLifecycle`, where
 * `useSession()` is unsafe per better-auth 1.6.3 quirk).
 */
export function usePostHogIdentify(): void {
  const consent = useCookieConsentStore(state => state.consent);
  const analyticsDenied = consent?.analytics === false;
  const { data: session, isPending } = authClient.useSession();
  const hadIdentifiedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (!isPosthogConfigured()) {
      return;
    }
    if (isPending) {
      return;
    }

    const userId = session?.user?.id;

    if (userId && !analyticsDenied) {
      const roleId = getSessionRoleId(session);
      posthog.identify(
        userId,
        roleId !== null ? { role_id: roleId } : undefined
      );
      hadIdentifiedRef.current = true;
      return;
    }

    if (!userId && hadIdentifiedRef.current) {
      posthog.reset();
      hadIdentifiedRef.current = false;
    }
  }, [session, isPending, analyticsDenied]);
}
