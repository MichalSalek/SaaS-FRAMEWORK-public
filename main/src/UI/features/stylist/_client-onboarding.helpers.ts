// UI/features/stylist/_client-onboarding.helpers.ts
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { capturePosthog } from '../../../application/analytics/posthog-client';

// DECISION: a role-less account tapping „Poproś o połączenie” came for THIS stylist, so
// onboarding gets the client role preselected and the profile as the way back; bare /app
// ended on „Zeskanuj kod stylistki” and the stylist was lost.
export function clientOnboardingHref(profilePath: string): string {
  return `${ROUTES_FRONT.ONBOARDING}?role=client&from=${encodeURIComponent(profilePath)}`;
}

/** Funnel counter fires only when the response says `created`: a repeated POST
 *  that creates nothing returns created=false and sends nothing (no test pins
 *  this). pair_id joins it with pair_request_accepted/declined on the stylist's side. */
export function trackPairRequestSent(
  stylistAccountId: string,
  data: { status: string; created: boolean; pair_id: string | null }
): void {
  if (data.status === 'PENDING' && data.created) {
    capturePosthog('pair_request_sent', {
      stylist_account_id: stylistAccountId,
      pair_id: data.pair_id,
    });
  }
}

/** Header link that opens the cancel-request dialog of the actions section. */
export const CANCEL_REQUEST_HASH = '#cancel-request';
