// UI/features/salon-profile/salonProfileFlowTrace.ts
// Named analytics trace of the salon configuration (flow `salon_profile`).
// Facts only: counts and switches, never the name, address or contact data.

import { trackFlowStep } from '../../../application/analytics/flow-events';
import { flowErrorCode } from '../shared/analytics/flowErrorCode';

export function traceSalonProfileSaved(pins: number, showTeam: boolean): void {
  trackFlowStep('salon_profile', 'saved', { pins, show_team: showTeam });
}

export function traceSalonProfileFailed(error: unknown): void {
  trackFlowStep('salon_profile', 'failed', {
    code: flowErrorCode(error),
  });
}

export function traceSalonVisibilityChanged(visible: boolean): void {
  trackFlowStep('salon_profile', 'visibility_changed', { visible });
}

/** The one-time „Opublikuj”: whether she filled any contact on the way. */
export function traceSalonProfilePublished(withContact: boolean): void {
  trackFlowStep('salon_profile', 'published', { with_contact: withContact });
}
