import { syncConfirmedLifecycleActions } from '../../domain/email/email-lifecycle-actions.analytics';
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { authClient } from '../../application/auth/better-auth-client';
import { recordLifecycleEntry_IO } from '../../domain/email/emailIO.possibilities.api';
import { emitAnalyticsEvent } from '../../application/analytics/analytics-sinks';
import { usePostHogReadinessStore } from '../../application/analytics/posthog-readiness.store';
import { useCookieConsentStore } from '../../application/stores/cookieConsent.store';
import {
  captureLifecycleFromUrl,
  readPendingLifecycle,
  lifecycleTrackingAllowed,
  saveLifecycleAttribution,
  lifecycleDimensions,
  setLifecycleEntryValidation,
} from '../../application/analytics/email-lifecycle';

// Shared across StrictMode mounts; the stable server entry id also deduplicates a full reload.
const validated = new Set<string>();
const inflight = new Set<string>();

export function EmailLifecycleBridgeComposition() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id;
  const identified = usePostHogReadinessStore(state => state.identifiedUserId);
  const consent = useCookieConsentStore(state => state.consent);

  useEffect(() => {
    captureLifecycleFromUrl();
    if (!userId || identified !== userId || consent?.analytics === false) {
      return;
    }
    const interact = (event: Event) => {
      if (
        !event.isTrusted ||
        !/^(?:\/(?:en|de))?\/app(?:\/|$)/.test(window.location.pathname) ||
        !lifecycleTrackingAllowed(userId)
      ) {
        return;
      }
      const pending = readPendingLifecycle();
      if (!pending) {
        void syncConfirmedLifecycleActions();
        return;
      }
      const key = `${userId}:${pending.entryId}`;
      if (validated.has(key) || inflight.has(key)) {
        void syncConfirmedLifecycleActions();
        return;
      }
      inflight.add(key);
      const validation = recordLifecycleEntry_IO({
        messageId: pending.messageId,
        ctaId: pending.ctaId,
        entryId: pending.entryId,
        interactedAt: new Date().toISOString(),
      })
        .then(({ attribution }) => {
          validated.add(key);
          if (!attribution || !lifecycleTrackingAllowed(userId)) {
            return;
          }
          saveLifecycleAttribution(attribution, userId);
          emitAnalyticsEvent(
            'email_lifecycle_entry',
            {
              ...lifecycleDimensions(attribution),
            },
            {
              uuid: attribution.entryId,
              timestamp: new Date(attribution.enteredAt),
            }
          );
        })
        .catch(() => {
          /* A later trusted interaction can retry with the same visit id. */
        })
        .finally(() => inflight.delete(key));
      setLifecycleEntryValidation(validation);
      void syncConfirmedLifecycleActions();
    };
    window.addEventListener('pointerdown', interact, true);
    window.addEventListener('keydown', interact, true);
    return () => {
      window.removeEventListener('pointerdown', interact, true);
      window.removeEventListener('keydown', interact, true);
    };
  }, [router.asPath, userId, identified, consent]);
  return null;
}
