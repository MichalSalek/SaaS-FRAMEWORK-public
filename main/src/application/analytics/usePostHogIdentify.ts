import { useEffect, useRef } from 'react';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { authClient } from '../auth/better-auth-client';
import { getSessionRoleId } from '../auth/session-fields.helpers';
import { getFromClientStorage } from '../client-device-storage/clientStorage.possibilities.api';
import { useCookieConsentStore } from '../stores/cookieConsent.store';
import { isPosthogConfigured } from './analytics.config';
import { getFirstTouchPersonProperties } from './first-touch';
import {
  isInternalTrafficEnabled,
  setInternalTrafficCookie,
  setInternalTrafficCookieForMasterAdmin,
} from './internal-traffic';
import { getPosthog } from './posthog-client';
import { usePostHogReadinessStore } from './posthog-readiness.store';
import { linkAnalyticsSessions } from './session-link';

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
  const posthogReady = usePostHogReadinessStore(state => state.isReady);
  const { data: session, isPending } = authClient.useSession();
  const identifiedUserIdRef = useRef<string | null>(null);
  const resetForImpersonationRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const roleId = getSessionRoleId(session);
    const becomeToken = getFromClientStorage({
      key: CUSTOM_HEADERS.becomeUser,
    });
    const isImpersonating = becomeToken !== null && becomeToken !== '';
    if (isImpersonating) {
      setInternalTrafficCookie(true);
    } else if (roleId === SystemRoleId.MASTER_ADMIN) {
      setInternalTrafficCookieForMasterAdmin();
    }

    if (!isPosthogConfigured()) {
      return;
    }

    // Ready means `init` has finished, so the instance is attached.
    const posthog = getPosthog();
    if (!posthogReady || posthog === null) {
      return;
    }

    if (isImpersonating) {
      // DECISION: the become-user token is a gate BEFORE identify and clears the previous person;
      // otherwise the admin's events were recorded on the impersonated stylist's profile.
      if (!resetForImpersonationRef.current) {
        posthog.reset();
        resetForImpersonationRef.current = true;
      }
      posthog.opt_out_capturing();
      posthog.stopSessionRecording();
      identifiedUserIdRef.current = null;
      usePostHogReadinessStore.getState().clearIdentified();
      return;
    }
    resetForImpersonationRef.current = false;

    // Own traffic is not measured (DECISION in internal-traffic.ts). The admin
    // cookie is set a few lines above, AFTER PostHog may have started on this
    // page: it stops here, before identify, and never starts on the next load.
    if (isInternalTrafficEnabled()) {
      posthog.opt_out_capturing();
      posthog.stopSessionRecording();
      return;
    }

    if (isPending) {
      return;
    }

    const userId = session?.user?.id;

    if (userId && !analyticsDenied) {
      const readiness = usePostHogReadinessStore.getState();
      if (readiness.identifiedUserId !== userId) {
        try {
          posthog.identify(
            userId,
            roleId !== null ? { role_id: roleId } : undefined
          );
          const firstTouch = getFirstTouchPersonProperties();
          if (Object.keys(firstTouch).length > 0) {
            posthog.people.set_once(firstTouch);
          }
          identifiedUserIdRef.current = userId;
          readiness.markIdentified(userId);
          // Clarity follows the identified person, not the anonymous id.
          linkAnalyticsSessions(posthog);
        } catch {
          return;
        }
      } else {
        identifiedUserIdRef.current = userId;
      }
      return;
    }

    if (!userId && identifiedUserIdRef.current !== null) {
      posthog.reset();
      identifiedUserIdRef.current = null;
      usePostHogReadinessStore.getState().clearIdentified();
    }
  }, [session, isPending, analyticsDenied, posthogReady]);
}
