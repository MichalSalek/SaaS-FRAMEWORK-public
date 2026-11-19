import { defineContracts } from '../../application/contracts/contract.types';
import {
  salonLogoSetSchema,
  salonSetLogoSchema,
} from '../user/user-avatar.contract-schemas';
import {
  QUERY_FIELD,
  type QueryField,
} from '../../application/contracts/query-fields';
import {
  salonGalleryPageSchema,
  salonGallerySchema,
  salonProfileContactResponseSchema,
  salonProfileContactSchema,
  salonProfileDataSchema,
  salonProfileUpdateSchema,
  salonProfileVisibilityResponseSchema,
  salonProfileVisibilitySchema,
  salonProfileVisibilityUpdatedSchema,
  salonSlugAvailabilityResponseSchema,
  salonSlugAvailabilitySchema,
} from './salon-profile.contract-schemas';

/** Comma-joined ids. The salon gallery client already joins; repeated keys are split too. */
const idList = (): QueryField<string, string[] | undefined> => ({
  decode: raw => {
    const ids: string[] = [];
    const add = (value: string) => {
      for (const part of value.split(',')) {
        if (part.length > 0) {
          ids.push(part);
        }
      }
    };
    if (typeof raw === 'string') {
      add(raw);
    } else if (Array.isArray(raw)) {
      for (const item of raw) {
        add(item);
      }
    }
    return ids.length > 0 ? ids : undefined;
  },
});

/**
 * Present number, including NaN and fractions, so `z.coerce.number().int()` still 400s a bad take.
 * QUERY_FIELD.int would floor and fall back instead.
 */
const strictNumber = (): QueryField<number, number | undefined> => ({
  decode: raw => {
    if (typeof raw !== 'string' || raw.length === 0) {
      return undefined;
    }
    return Number(raw);
  },
});

const presentString = (): QueryField<string, string> & {
  readonly required: true;
} => ({
  required: true,
  decode: raw => (typeof raw === 'string' ? raw : ''),
});

const galleryQuery = {
  salon_account_id: presentString(),
  stylist_account_id: QUERY_FIELD.string(),
  cursor: QUERY_FIELD.string(),
  take: strictNumber(),
  color_ids: idList(),
  trait_ids: idList(),
  nail_length: QUERY_FIELD.string(),
};

export const SALON_PROFILE_CONTRACTS = defineContracts({
  SALON_PROFILE_SET_LOGO: {
    summary: 'Ustawia albo czyści niezależne logo salonu właścicielki.',
    group: 'SALON_PROFILE',
    kind: 'COMMAND',
    path: 'salon/profile/set-logo',
    method: 'POST',
    body: salonSetLogoSchema,
    query: null,
    response: salonLogoSetSchema,
    successEvents: ['SALON_PROFILE_UPDATED'],
    auditEvents: ['SALON_PROFILE_UPDATED'],
    access: 'STYLIST',
    authCheck: true,
    limiterTier: 'default',
  },
  SALON_PROFILE_UPDATE: {
    summary:
      'Zapisuje nazwę, link, kolor, kontakt, widoczność zespołu i przypięte prace salonu.',
    group: 'SALON_PROFILE',
    kind: 'COMMAND',
    path: 'salon/profile/update',
    method: 'POST',
    body: salonProfileUpdateSchema,
    query: null,
    response: salonProfileDataSchema,
    successEvents: ['SALON_PROFILE_UPDATED'],
    auditEvents: [],
    access: 'STYLIST',
    authCheck: true,
    limiterTier: 'default',
  },
  SALON_PROFILE_CONTACT: {
    summary:
      'Wysyła wiadomość do stylistki salonu i zwraca identyfikator pary.',
    group: 'SALON_PROFILE',
    kind: 'COMMAND',
    path: 'salon/profile/contact',
    method: 'POST',
    body: salonProfileContactSchema,
    query: null,
    response: salonProfileContactResponseSchema,
    successEvents: ['MESSAGING_MESSAGE_SENT'],
    auditEvents: ['MESSAGING_MESSAGE_SENT'],
    access: 'CLIENT',
    authCheck: true,
    limiterTier: 'default',
  },
  SALON_PROFILE_VISIBILITY_UPDATE: {
    summary: 'Włącza albo wyłącza widoczność profilu salonu.',
    group: 'SALON_PROFILE',
    kind: 'COMMAND',
    path: 'salon/profile/visibility',
    method: 'POST',
    body: salonProfileVisibilitySchema,
    query: null,
    response: salonProfileVisibilityUpdatedSchema,
    successEvents: ['SALON_PROFILE_VISIBILITY_UPDATED'],
    auditEvents: [],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },
  SALON_GALLERY_GET: {
    summary: 'Zwraca prace salonu dla zalogowanej osoby.',
    group: 'SALON_PROFILE',
    kind: 'QUERY',
    path: 'salon/gallery',
    method: 'GET',
    body: null,
    query: galleryQuery,
    querySchema: salonGallerySchema,
    response: salonGalleryPageSchema,
    successEvents: ['SALON_PROFILE_FETCHED'],
    auditEvents: [],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },
  SALON_GALLERY_PUBLIC_GET: {
    summary: 'Zwraca publiczne prace salonu.',
    group: 'SALON_PROFILE',
    kind: 'QUERY',
    path: 'public/salon-gallery',
    method: 'GET',
    body: null,
    query: galleryQuery,
    querySchema: salonGallerySchema,
    response: salonGalleryPageSchema,
    successEvents: ['SALON_PROFILE_FETCHED'],
    auditEvents: [],
    access: 'PUBLIC',
    authCheck: false,
    limiterTier: 'strict',
  },
  SALON_PROFILE_GET: {
    summary: 'Zwraca profil salonu do edycji przez właścicielkę.',
    group: 'SALON_PROFILE',
    kind: 'QUERY',
    path: 'salon/profile',
    method: 'GET',
    body: null,
    query: null,
    response: salonProfileDataSchema,
    successEvents: ['SALON_PROFILE_FETCHED'],
    auditEvents: [],
    access: 'STYLIST',
    authCheck: true,
    limiterTier: 'default',
  },
  SALON_PROFILE_SLUG_AVAILABLE: {
    summary: 'Sprawdza, czy link salonu jest wolny.',
    group: 'SALON_PROFILE',
    kind: 'QUERY',
    path: 'salon/profile/slug-available',
    method: 'GET',
    body: null,
    query: { slug: QUERY_FIELD.requiredString() },
    querySchema: salonSlugAvailabilitySchema,
    response: salonSlugAvailabilityResponseSchema,
    successEvents: ['SALON_PROFILE_FETCHED'],
    auditEvents: [],
    access: 'STYLIST',
    authCheck: true,
    limiterTier: 'strict',
  },
  SALON_PROFILE_VISIBILITY_GET: {
    summary: 'Zwraca, czy profil salonu jest widoczny.',
    group: 'SALON_PROFILE',
    kind: 'QUERY',
    path: 'salon/profile/visibility/get',
    method: 'GET',
    body: null,
    query: null,
    response: salonProfileVisibilityResponseSchema,
    successEvents: ['SALON_PROFILE_FETCHED'],
    auditEvents: [],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },
  SALON_PROFILE_PUBLIC_GET: {
    summary: 'Zwraca publiczny profil salonu po identyfikatorze albo linku.',
    group: 'SALON_PROFILE',
    kind: 'QUERY',
    path: 'public/salon-profile',
    method: 'GET',
    body: null,
    query: {
      identifier: QUERY_FIELD.requiredString(),
      by: QUERY_FIELD.oneOf(['slug'] as const),
    },
    response: salonProfileDataSchema,
    successEvents: ['SALON_PROFILE_FETCHED'],
    auditEvents: [],
    access: 'PUBLIC',
    authCheck: true,
    limiterTier: 'strict',
  },
});

export type SalonProfileContracts = typeof SALON_PROFILE_CONTRACTS;
