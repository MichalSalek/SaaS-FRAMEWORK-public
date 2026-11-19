import { defineContracts } from '../../application/contracts/contract.types';
import { QUERY_FIELD } from '../../application/contracts/query-fields';
import {
  clientContactForStylistSchema,
  clientContactUpdatedSchema,
  clientDeleteCrmNoteSchema,
  clientNoteClearedSchema,
  clientNoteSchema,
  clientProfileSchema,
  clientUpdateContactSchema,
  clientUpsertCrmNoteSchema,
  clientUpsertImportantNoteSchema,
} from './client.contract-schemas';

/**
 * Client profile, contact disclosure and the stylist's private notes.
 * A missing client_user_id stays the handler 400 `{ client_user_id: 'Required' }`
 * (QUERY_FIELD.requiredString, no query schema). GET profile has no fields; the empty
 * map keeps the existing call `getClientProfile_IO({})` typed, and it adds no query string.
 * CRM and important-note bodies are the objects in domain/visit/crm-note.schemas.ts.
 */

const clientUserIdQuery = {
  client_user_id: QUERY_FIELD.requiredString(),
};

export const CLIENT_CONTRACTS = defineContracts({
  CLIENT_UPDATE_CONTACT: {
    summary:
      'Klientka zapisuje telefon i e-mail kontaktowy. Puste pole czyści zapisaną wartość.',
    group: 'CLIENT',
    kind: 'COMMAND',
    path: 'client/update-contact',
    method: 'POST',
    body: clientUpdateContactSchema,
    query: null,
    response: clientContactUpdatedSchema,
    successEvents: ['CLIENT_CONTACT_UPDATED'],
    auditEvents: ['CLIENT_CONTACT_UPDATED'],
    access: 'CLIENT',
    authCheck: true,
    limiterTier: 'default',
  },

  CLIENT_GET_PROFILE: {
    summary:
      'Profil kontaktowy zalogowanej klientki: telefon, e-mail i data utworzenia konta.',
    group: 'CLIENT',
    kind: 'QUERY',
    path: 'client/profile',
    method: 'GET',
    body: null,
    query: {},
    response: clientProfileSchema,
    successEvents: ['CLIENT_PROFILE_FETCHED'],
    auditEvents: [],
    access: 'CLIENT',
    authCheck: true,
    limiterTier: 'default',
  },

  CLIENT_GET_CONTACT_FOR_STYLIST: {
    summary: 'Stylistka odczytuje telefon, e-mail i imię sparowanej klientki.',
    group: 'CLIENT',
    kind: 'QUERY',
    path: 'client/contact/get-for-stylist',
    method: 'GET',
    body: null,
    query: clientUserIdQuery,
    response: clientContactForStylistSchema,
    successEvents: ['CLIENT_CONTACT_FETCHED'],
    auditEvents: [],
    access: 'STYLIST',
    authCheck: true,
    limiterTier: 'strict',
  },

  CLIENT_GET_CRM_NOTE: {
    summary:
      'Prywatna notatka CRM stylistki o klientce, z datą ostatniej zmiany.',
    group: 'CLIENT',
    kind: 'QUERY',
    path: 'client/crm-note/get',
    method: 'GET',
    body: null,
    query: clientUserIdQuery,
    response: clientNoteSchema,
    successEvents: ['CLIENT_CRM_NOTE_FETCHED'],
    auditEvents: [],
    access: 'STYLIST',
    authCheck: true,
    limiterTier: 'default',
  },

  CLIENT_UPSERT_CRM_NOTE: {
    summary: 'Zapis prywatnej notatki CRM stylistki o klientce.',
    group: 'CLIENT',
    kind: 'COMMAND',
    path: 'client/crm-note/upsert',
    method: 'POST',
    body: clientUpsertCrmNoteSchema,
    query: null,
    response: clientNoteSchema,
    successEvents: ['CLIENT_CRM_NOTE_UPSERTED'],
    auditEvents: ['CLIENT_CRM_NOTE_UPSERTED'],
    access: 'STYLIST',
    authCheck: true,
    limiterTier: 'default',
  },

  CLIENT_DELETE_CRM_NOTE: {
    summary: 'Usunięcie prywatnej notatki CRM. Działa w każdym stanie pary.',
    group: 'CLIENT',
    kind: 'COMMAND',
    path: 'client/crm-note/delete',
    method: 'POST',
    body: clientDeleteCrmNoteSchema,
    query: null,
    response: clientNoteClearedSchema,
    successEvents: ['CLIENT_CRM_NOTE_DELETED'],
    auditEvents: ['CLIENT_CRM_NOTE_DELETED'],
    access: 'STYLIST',
    authCheck: true,
    limiterTier: 'strict',
  },

  CLIENT_GET_IMPORTANT_NOTE: {
    summary:
      'Pole „Ważne przed wizytą” stylistki o klientce, z datą ostatniej zmiany.',
    group: 'CLIENT',
    kind: 'QUERY',
    path: 'client/important-note/get',
    method: 'GET',
    body: null,
    query: clientUserIdQuery,
    response: clientNoteSchema,
    successEvents: ['CLIENT_IMPORTANT_NOTE_FETCHED'],
    auditEvents: [],
    access: 'STYLIST',
    authCheck: true,
    limiterTier: 'default',
  },

  CLIENT_UPSERT_IMPORTANT_NOTE: {
    summary: 'Zapis pola „Ważne przed wizytą”. Pusta treść czyści pole.',
    group: 'CLIENT',
    kind: 'COMMAND',
    path: 'client/important-note/upsert',
    method: 'POST',
    body: clientUpsertImportantNoteSchema,
    query: null,
    response: clientNoteSchema,
    successEvents: ['CLIENT_IMPORTANT_NOTE_UPSERTED'],
    auditEvents: ['CLIENT_IMPORTANT_NOTE_UPSERTED'],
    access: 'STYLIST',
    authCheck: true,
    limiterTier: 'default',
  },
});

export type ClientContracts = typeof CLIENT_CONTRACTS;
