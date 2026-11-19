import type { IOClientCallOptions } from '@kernel/application/http/http.client.types';
import { contractEndpoint } from '../../application/http/io';
import { NOTIFICATIONS_CONTRACTS } from '@kernel/domain/notifications/notifications.contracts';

// Notification centre: list, badge, read marker, push devices. The `_IO` names
// stay. Reads carry the query signal through the same transport as before.
const C = NOTIFICATIONS_CONTRACTS;

const getOne = contractEndpoint(C.NOTIFICATIONS_GET_ONE);
export const getNotification_IO = (
  input: { id: string },
  options?: IOClientCallOptions
) => getOne({ ...input, notification_schema: '2' }, options);

const getRecent = contractEndpoint(C.NOTIFICATIONS_GET_RECENT);
export const getRecentNotifications_IO = (
  _input: undefined,
  options?: IOClientCallOptions
) => getRecent({ notification_schema: '2' }, options);
export const getUnreadNotificationsCount_IO = contractEndpoint(
  C.NOTIFICATIONS_GET_UNREAD_COUNT
);
export const markNotificationsRead_IO = contractEndpoint(
  C.NOTIFICATIONS_MARK_READ,
  { errorFeedbackPolicy: 'background', successFeedback: 'silent' }
);
export const registerPushSubscription_IO = contractEndpoint(
  C.PUSH_SUBSCRIPTION_REGISTER
);
export const unregisterPushSubscription_IO = contractEndpoint(
  C.PUSH_SUBSCRIPTION_UNREGISTER
);
