import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type { ContactTopic } from '../../domain/support/contact-topics.config';

// Single SSOT: contact topics live in domain/support/contact-topics.config
// (also drives VALID_CONTACT_TOPICS runtime validation). Re-exported as
// ContactFormTopic so any drift between the two surfaces is a compile error.
export type ContactFormTopic = ContactTopic;

/**
 * Public list item for stylists tab in Favorites/Explore.
 * Only public-safe fields (NO email/phone/address — see SECURITY in handler).
 */
export type StylistPublicListItemDTO = {
  account_id: string;
  identifier: string; // vanity_url if set, else account_id (used in profile URL slug)
  display_name: string | null;
  avatar_url: string | null;
  city: string | null;
  instagram_handle: string | null;
  bookmark_count: number;
  photo_count: number;
  is_pro_or_higher: boolean; // pricing tier indicator (PRO+, no exact plan exposed)
  // Branding-light krok 2 (2026-07-12): kolor marki na coverze karty Explore.
  // null gdy brak LUB plan bez can_brand_profile (maska na read, S51).
  brand_accent_color: string | null;
};

export type PUBLIC_DTO_API_V1 = {
  /** Przyjmuje zgłoszenie z publicznego formularza kontaktowego (imię, temat, email, treść); odpowiedź bez ciała. */
  CONTACT_FORM_SUBMIT: {
    REQUEST: {
      name: string;
      topic: ContactFormTopic;
      email: string;
      message: string;
      // Cloudflare Turnstile response token (anty-spam). Optional w KONTRAKCIE:
      // wymagalność jest runtime'owa — serwer wymusza obecność TYLKO gdy
      // TURNSTILE_SECRET_KEY jest skonfigurowany (feature-flag by presence);
      // dev/staging bez sekretu przechodzi bez tokenu (back-compat).
      turnstile_token?: string;
    };
    RESPONSE: undefined;
    RESPONSE_ERROR: DetailedErrorPayload<
      PUBLIC_DTO_API_V1['CONTACT_FORM_SUBMIT']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      PUBLIC_DTO_API_V1['CONTACT_FORM_SUBMIT']['REQUEST'],
      PUBLIC_DTO_API_V1['CONTACT_FORM_SUBMIT']['RESPONSE'],
      PUBLIC_DTO_API_V1['CONTACT_FORM_SUBMIT']['RESPONSE_ERROR']
    >;
  };

  /** Zwraca stronicowaną, publiczną listę stylistek (tylko pola bezpieczne publicznie) z filtrem miasta i frazą wyszukiwania. */
  GET_PUBLIC_STYLISTS_LIST: {
    REQUEST: {
      cursor?: string;
      take?: number;
      city?: string;
      searchQuery?: string;
    };
    RESPONSE: {
      stylists: StylistPublicListItemDTO[];
      nextCursor: string | null;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      PUBLIC_DTO_API_V1['GET_PUBLIC_STYLISTS_LIST']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      PUBLIC_DTO_API_V1['GET_PUBLIC_STYLISTS_LIST']['REQUEST'],
      PUBLIC_DTO_API_V1['GET_PUBLIC_STYLISTS_LIST']['RESPONSE'],
      PUBLIC_DTO_API_V1['GET_PUBLIC_STYLISTS_LIST']['RESPONSE_ERROR']
    >;
  };

  /** Healthcheck publicznego API: status bazy i API, uptime w sekundach oraz znacznik czasu. */
  INTERNAL_HEALTH_PUBLIC: {
    REQUEST: undefined;
    RESPONSE: {
      database: 'up' | 'down';
      api: 'up' | 'down';
      uptime_seconds: number;
      ts: string;
    };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      undefined,
      PUBLIC_DTO_API_V1['INTERNAL_HEALTH_PUBLIC']['RESPONSE'],
      PUBLIC_DTO_API_V1['INTERNAL_HEALTH_PUBLIC']['RESPONSE_ERROR']
    >;
  };

  /** Zewnętrzny zegar sweepów: czy to wywołanie uruchomiło sweepy utrzymaniowe. */
  INTERNAL_SWEEP_TICK: {
    REQUEST: undefined;
    RESPONSE: {
      ran: boolean;
    };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      undefined,
      PUBLIC_DTO_API_V1['INTERNAL_SWEEP_TICK']['RESPONSE'],
      PUBLIC_DTO_API_V1['INTERNAL_SWEEP_TICK']['RESPONSE_ERROR']
    >;
  };
};
