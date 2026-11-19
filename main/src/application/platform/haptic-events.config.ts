// application/platform/haptic-events.config.ts
// The ONE list of moments the phone vibrates at.
//
// DECISION: haptics follow OUTCOMES, never touches (owner). Nothing vibrates on a touch; a haptic
// follows an outcome the server confirmed: the event pipeline (`event-bus/eventPipeline.orchestrator.ts`,
// stage HAPTIC) looks the event up here. To add a haptic, add an event; never call the plugin from a
// component for a server outcome, and never on press, toggle, navigation, a sent message or a like.
//
// Outcomes that never reach the app as ONE server event carry their own call, exactly these: a QR
// code recognised by the camera (`useQrScanner`), a payment confirmed or refused by the payment form
// (`CheckoutForm`), and a work that failed to publish (`useUploadAssetState`; the upload has two
// steps and the first never passes the event pipeline).

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';

export type HapticOutcome = 'Success' | 'Warning';

export const HAPTIC_BY_EVENT: Partial<Record<EVENT_INFO_TYPE, HapticOutcome>> =
  {
    // A work is published: the success screen (or the first-photo celebration)
    // appears with this vibration.
    [APP_EVENTS.INFO.GALLERY.GALLERY_RECORD_CREATED]: 'Success',
    // A connection is asked for and a connection is made.
    [APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_SENT]: 'Success',
    [APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_ACCEPTED]: 'Success',
    // The client hands her inspirations to the stylist.
    [APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_SHARED]: 'Success',
    // The account is ready (end of the first steps), for either role.
    [APP_EVENTS.INFO.USER.STYLIST_ACCOUNT_CREATED]: 'Success',
    [APP_EVENTS.INFO.USER.CLIENT_ACCOUNT_CREATED]: 'Success',
    // The account is switched off or scheduled for deletion: it happened.
    [APP_EVENTS.INFO.USER.USER_DISABLED_SELF]: 'Warning',
    [APP_EVENTS.INFO.USER.USER_DELETED_SELF]: 'Warning',
  };

/** Never vibrate for an existing or unproven connection request. */
export const resolveHapticOutcome = (
  event: EVENT_INFO_TYPE,
  evidence?: { created?: unknown }
): HapticOutcome | undefined => {
  if (
    event === APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_SENT &&
    evidence?.created !== true
  ) {
    return undefined;
  }
  return HAPTIC_BY_EVENT[event];
};
