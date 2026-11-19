import { z } from 'zod';
import { defineContracts } from '../../application/contracts/contract.types';
import { QUERY_FIELD } from '../../application/contracts/query-fields';
import { announcementTranslationsSchema } from '../admin/announcement-content';

const announcement = z.object({
  id: z.string(),
  title: z.string(),
  message: z.string(),
  type: z.enum(['info', 'warning', 'critical']),
  translations: announcementTranslationsSchema,
  audience_anonymous: z.boolean(),
  audience_client: z.boolean(),
  audience_stylist: z.boolean(),
});

/**
 * Public application reads. Both are in BASE_PERMISSIONS and skip the session
 * gate so a recovering account is not evicted.
 */
export const APPLICATION_CONTRACTS = defineContracts({
  ANNOUNCEMENTS_GET_ACTIVE: {
    summary: 'Aktywne ogłoszenia systemowe widoczne w aplikacji.',
    group: 'APPLICATION',
    kind: 'QUERY',
    path: 'announcements/active',
    method: 'GET',
    body: null,
    query: { surface: QUERY_FIELD.oneOf(['public', 'app'] as const) },
    response: z.array(announcement),
    successEvents: ['ACTIVE_ANNOUNCEMENTS_FETCHED'],
    auditEvents: [],
    access: 'PUBLIC',
    authCheck: false,
    limiterTier: 'default',
  },
  GET_RUNTIME_CONFIG_PUBLIC: {
    summary:
      'Publiczny wycinek konfiguracji: przerwa techniczna i poziom logów.',
    group: 'APPLICATION',
    kind: 'QUERY',
    path: 'runtime-config',
    method: 'GET',
    body: null,
    query: null,
    response: z.object({
      maintenanceMessage: z.string(),
      maintenanceMode: z.boolean(),
      verboseLogMode: z.boolean(),
    }),
    successEvents: ['PUBLIC_RUNTIME_CONFIG_FETCHED'],
    auditEvents: [],
    access: 'PUBLIC',
    authCheck: false,
    limiterTier: 'default',
  },
});

export type ApplicationContracts = typeof APPLICATION_CONTRACTS;
