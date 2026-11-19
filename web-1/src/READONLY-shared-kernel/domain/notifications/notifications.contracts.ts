import { QUERY_FIELD } from '../../application/contracts/query-fields';
import { defineContracts } from '../../application/contracts/contract.types';
import {
  notificationOneSchema,
  markedReadSchema,
  notificationsMarkReadSchema,
  pushSubscriptionRegisterSchema,
  pushSubscriptionUnregisterSchema,
  recentNotificationsSchema,
  subscriptionRegisteredSchema,
  subscriptionRemovedSchema,
  unreadCountSchema,
} from './notifications.contract-schemas';

/**
 * Notification centre and push devices. Every operation is any logged-in role.
 * The optional wire capability keeps older tabs compatible. Dates are ISO strings.
 */

export const NOTIFICATIONS_CONTRACTS = defineContracts({
  NOTIFICATIONS_GET_ONE: {
    summary:
      'Odczytuje własne powiadomienie i rolę potrzebną do otwarcia celu.',
    group: 'NOTIFICATIONS',
    kind: 'QUERY',
    path: 'notifications/get-one',
    method: 'GET',
    body: null,
    query: {
      id: QUERY_FIELD.requiredString(),
      notification_schema: QUERY_FIELD.oneOf(['2']),
    },
    response: notificationOneSchema,
    successEvents: ['NOTIFICATION_FETCHED'],
    auditEvents: [],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },
  NOTIFICATIONS_GET_RECENT: {
    summary:
      'Najnowsze powiadomienia zalogowanej osoby w aktywnej roli oraz licznik nieprzeczytanych.',
    group: 'NOTIFICATIONS',
    kind: 'QUERY',
    path: 'notifications/recent',
    method: 'GET',
    body: null,
    query: { notification_schema: QUERY_FIELD.oneOf(['2']) },
    response: recentNotificationsSchema,
    successEvents: ['NOTIFICATIONS_FETCHED'],
    auditEvents: [],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },

  NOTIFICATIONS_GET_UNREAD_COUNT: {
    summary: 'Liczba nieprzeczytanych powiadomień dla aktywnej roli (dzwonek).',
    group: 'NOTIFICATIONS',
    kind: 'QUERY',
    path: 'notifications/unread-count',
    method: 'GET',
    body: null,
    query: null,
    response: unreadCountSchema,
    successEvents: ['NOTIFICATIONS_UNREAD_COUNT_FETCHED'],
    auditEvents: [],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },

  NOTIFICATIONS_MARK_READ: {
    summary:
      'Oznacza jako przeczytane wiersze widziane do newest_seen_at. Nowszy wiersz zostaje.',
    group: 'NOTIFICATIONS',
    kind: 'COMMAND',
    path: 'notifications/mark-read',
    method: 'POST',
    body: notificationsMarkReadSchema,
    query: null,
    response: markedReadSchema,
    successEvents: ['NOTIFICATIONS_MARKED_READ'],
    auditEvents: [],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },

  PUSH_SUBSCRIPTION_REGISTER: {
    summary:
      'Zapisuje urządzenie do push (przeglądarka albo token FCM) dla zalogowanej osoby.',
    group: 'NOTIFICATIONS',
    kind: 'COMMAND',
    path: 'notifications/push/register',
    method: 'POST',
    body: pushSubscriptionRegisterSchema,
    query: null,
    response: subscriptionRegisteredSchema,
    successEvents: ['PUSH_SUBSCRIPTION_REGISTERED'],
    auditEvents: ['PUSH_SUBSCRIPTION_REGISTERED'],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },

  PUSH_SUBSCRIPTION_UNREGISTER: {
    summary:
      'Wyrejestrowuje urządzenie wywołującej osoby. Cudzy endpoint zwraca removed: false.',
    group: 'NOTIFICATIONS',
    kind: 'COMMAND',
    path: 'notifications/push/unregister',
    method: 'POST',
    body: pushSubscriptionUnregisterSchema,
    query: null,
    response: subscriptionRemovedSchema,
    successEvents: ['PUSH_SUBSCRIPTION_UNREGISTERED'],
    auditEvents: ['PUSH_SUBSCRIPTION_UNREGISTERED'],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },
});

export type NotificationsContracts = typeof NOTIFICATIONS_CONTRACTS;
