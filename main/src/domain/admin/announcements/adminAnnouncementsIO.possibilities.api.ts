// main/src/domain/admin/announcements/adminAnnouncementsIO.possibilities.api.ts
// IO functions for admin announcements (frontend client): list/create/update/delete
// + public active-announcements banner fetch.
//
// The `admin` domain uses the promise-first front door (`defineEndpoint`): every `_IO` returns
// `Promise<Res>` and hooks call it directly.
//
// Snackbars: no `pushNewSnackbar(response.event)` in these IO functions. The event-bus interceptor
// (`http.interceptor` → `pushEventToBus`) already pushes a snackbar for the `response.event` of
// every successful response (unless the event is in `eventsDisallowedForUI`); a second one is a
// duplicate.

import { contractEndpoint } from '../../../application/http/io';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APPLICATION_CONTRACTS } from '@kernel/domain/application/application.contracts';

const C = ADMIN_CONTRACTS;

export const adminGetAnnouncements_IO = contractEndpoint(
  C.ADMIN_GET_ANNOUNCEMENTS
);
export const adminCreateAnnouncement_IO = contractEndpoint(
  C.ADMIN_CREATE_ANNOUNCEMENT,
  { successFeedback: 'screen' }
);
export const adminUpdateAnnouncement_IO = contractEndpoint(
  C.ADMIN_UPDATE_ANNOUNCEMENT,
  { successFeedback: 'screen' }
);
export const adminDeleteAnnouncement_IO = contractEndpoint(
  C.ADMIN_DELETE_ANNOUNCEMENT
);
export const adminSendAnnouncementNotification_IO = contractEndpoint(
  C.ADMIN_SEND_ANNOUNCEMENT_NOTIFICATION,
  { successFeedback: 'screen' }
);
export const adminTestAnnouncementNotification_IO = contractEndpoint(
  C.ADMIN_TEST_ANNOUNCEMENT_NOTIFICATION,
  { successFeedback: 'screen', errorFeedbackPolicy: 'background' }
);

export const getActiveAnnouncements_IO = contractEndpoint(
  APPLICATION_CONTRACTS.ANNOUNCEMENTS_GET_ACTIVE,
  // Public banner GET: a background outage settles without a snackbar. The banner stays empty.
  { errorFeedbackPolicy: 'background' }
);
