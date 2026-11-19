import { defineContracts } from '../../application/contracts/contract.types';
import { QUERY_FIELD } from '../../application/contracts/query-fields';
import {
  currentSessionUserSchema,
  emptyResponse,
  sessionDeleteAllSchema,
  sessionDeleteExactlySchema,
  sessionListSchema,
} from './session.contract-schemas';

/**
 * Session list and revoke. GET current is in BASE, so access stays PUBLIC with the
 * auth gate on (a missing session is NOT_LOGGED_IN, not a skipped check).
 * `take` falls back to 50; the handler still clamps the decoded number to 1..100.
 */

export const SESSION_CONTRACTS = defineContracts({
  SESSION_DELETE_ALL: {
    summary:
      'Kończy wszystkie sesje zalogowanej osoby albo, dla administratora, wskazanego użytkownika.',
    group: 'SESSION',
    kind: 'COMMAND',
    path: 'session/delete/all',
    method: 'POST',
    body: sessionDeleteAllSchema,
    query: null,
    response: emptyResponse,
    successEvents: ['USER_LOGGED_OUT', 'ADMIN_USER_SESSIONS_REVOKED'],
    auditEvents: ['USER_LOGGED_OUT'],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },
  SESSION_DELETE_EXACTLY: {
    summary: 'Kończy jedną sesję zalogowanej osoby.',
    group: 'SESSION',
    kind: 'COMMAND',
    path: 'session/delete/exactly',
    method: 'POST',
    body: sessionDeleteExactlySchema,
    query: null,
    response: emptyResponse,
    successEvents: ['SESSION_DELETED_EXACTLY', 'CANNOT_DELETE_SESSION'],
    auditEvents: ['SESSION_DELETED_EXACTLY'],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },
  SESSION_GET_ALL: {
    summary: 'Zwraca sesje zalogowanej osoby, strona po stronie.',
    group: 'SESSION',
    kind: 'QUERY',
    path: 'session/get-all',
    method: 'GET',
    body: null,
    query: {
      cursor: QUERY_FIELD.string(),
      take: QUERY_FIELD.int(50),
    },
    response: sessionListSchema,
    successEvents: ['SUCCESS'],
    auditEvents: [],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },
  SESSION_GET_CURRENT: {
    summary: 'Zwraca zalogowaną osobę i jej bieżącą sesję.',
    group: 'SESSION',
    kind: 'QUERY',
    path: 'session/get-current',
    method: 'GET',
    body: null,
    query: {},
    response: currentSessionUserSchema,
    successEvents: ['SUCCESS'],
    auditEvents: [],
    access: 'PUBLIC',
    authCheck: true,
    limiterTier: 'default',
  },
});

export type SessionContracts = typeof SESSION_CONTRACTS;
