import { z } from 'zod';
import { defineContracts } from '../../application/contracts/contract.types';
import { QUERY_FIELD } from '../../application/contracts/query-fields';
import { contactFormSubmitSchema } from '../../policies/validation/misc.validation';

const stylistCard = z.object({
  account_id: z.string(),
  identifier: z.string(),
  display_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  avatar_fallback_url: z.string().nullable().optional(),
  city: z.string().nullable(),
  instagram_handle: z.string().nullable(),
  bookmark_count: z.number(),
  photo_count: z.number(),
  is_pro_or_higher: z.boolean(),
  brand_accent_color: z.string().nullable(),
  sample_photo_urls: z.array(z.string()),
});

/**
 * Public JSON endpoints that are not gallery or salon.
 * Contact form has no BASE_PERMISSIONS line (`PUBLIC_NO_GRANT`).
 */
export const PUBLIC_CONTRACTS = defineContracts({
  CONTACT_FORM_SUBMIT: {
    summary: 'Wiadomość z publicznego formularza kontaktu.',
    group: 'PUBLIC',
    kind: 'COMMAND',
    path: 'public/contact-form',
    method: 'POST',
    body: contactFormSubmitSchema,
    query: null,
    response: z.undefined(),
    successEvents: ['CONTACT_FORM_SUBMITTED'],
    auditEvents: [],
    access: 'PUBLIC_NO_GRANT',
    authCheck: false,
    limiterTier: 'strict',
  },
  GET_PUBLIC_STYLISTS_LIST: {
    summary: 'Publiczna stronicowana lista stylistek (miasto i fraza).',
    group: 'PUBLIC',
    kind: 'QUERY',
    path: 'stylist/get-public-list',
    method: 'GET',
    body: null,
    query: {
      cursor: QUERY_FIELD.string(),
      take: QUERY_FIELD.int(20),
      city: QUERY_FIELD.string(),
      searchQuery: QUERY_FIELD.string(),
    },
    response: z.object({
      stylists: z.array(stylistCard),
      nextCursor: z.string().nullable(),
    }),
    successEvents: ['PUBLIC_STYLISTS_LIST_FETCHED'],
    auditEvents: [],
    access: 'PUBLIC',
    authCheck: true,
    limiterTier: 'default',
  },
});

export type PublicContracts = typeof PUBLIC_CONTRACTS;
