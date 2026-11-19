import { defineContracts } from '../../application/contracts/contract.types';
import { QUERY_FIELD } from '../../application/contracts/query-fields';
import {
  emailLifecycleActionsSchema,
  emailLifecycleEntrySchema,
  emailUpdatePreferencesSchema,
} from '../../policies/validation/email.validation';
import {
  emailHistoryResponseSchema,
  emailLifecycleActionsResponseSchema,
  emailLifecycleEntryResponseSchema,
  emailPreferencesResponseSchema,
  emailScheduleResponseSchema,
} from './email.contract-schemas';

const historyQuery = {
  // Compatibility for older admin clients; the handler separately requires admin permission.
  userId: QUERY_FIELD.string(),
  cursor: QUERY_FIELD.string(),
  take: QUERY_FIELD.int(50),
};

/**
 * JSON email endpoints. Unsubscribe stays a raw HTML/redirect protocol
 * (`raw-protocols.ts`), not a contract.
 */
export const EMAIL_CONTRACTS = defineContracts({
  EMAIL_UPDATE_PREFERENCES: {
    summary:
      'Zapis preferencji maili konta stylistki (sekwencja trialu i marketing).',
    group: 'EMAIL',
    kind: 'COMMAND',
    path: 'email/update-preferences',
    method: 'POST',
    body: emailUpdatePreferencesSchema,
    query: null,
    response: emailPreferencesResponseSchema,
    successEvents: ['EMAIL_PREFERENCES_UPDATED'],
    auditEvents: [],
    // DECISION: stylist-only. A client has no StylistAccount, so a logged-in grant answered 404.
    access: 'STYLIST',
    authCheck: true,
    limiterTier: 'default',
  },
  EMAIL_LIFECYCLE_ENTRY: {
    summary: 'Zapis wejścia z linku maila cyklu życia i zwrot atrybucji.',
    group: 'EMAIL',
    kind: 'COMMAND',
    path: 'email/lifecycle-entry',
    method: 'POST',
    body: emailLifecycleEntrySchema,
    query: null,
    response: emailLifecycleEntryResponseSchema,
    successEvents: ['EMAIL_LIFECYCLE_ENTRY_RECORDED'],
    auditEvents: [],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },
  EMAIL_GET_SCHEDULE: {
    summary: 'Konfiguracja harmonogramu maili trialu, rezygnacji i planu Free.',
    group: 'EMAIL',
    kind: 'QUERY',
    path: 'email/get-schedule',
    method: 'GET',
    body: null,
    query: null,
    response: emailScheduleResponseSchema,
    successEvents: ['EMAIL_SCHEDULE_FETCHED'],
    auditEvents: [],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },
  EMAIL_LIFECYCLE_ACTIONS: {
    summary: 'Stronicowana lista potwierdzonych akcji cyklu życia maili.',
    group: 'EMAIL',
    kind: 'QUERY',
    path: 'email/lifecycle-actions',
    method: 'GET',
    body: null,
    query: { cursor: QUERY_FIELD.string() },
    querySchema: emailLifecycleActionsSchema,
    response: emailLifecycleActionsResponseSchema,
    successEvents: ['EMAIL_LIFECYCLE_ACTIONS_FETCHED'],
    auditEvents: [],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },
  EMAIL_GET_HISTORY: {
    summary: 'Stronicowana historia maili zalogowanej osoby.',
    group: 'EMAIL',
    kind: 'QUERY',
    path: 'email/get-history',
    method: 'GET',
    body: null,
    query: historyQuery,
    response: emailHistoryResponseSchema,
    successEvents: ['EMAIL_HISTORY_FETCHED'],
    auditEvents: [],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },
});

export type EmailContracts = typeof EMAIL_CONTRACTS;
