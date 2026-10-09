import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type { AccountType, StylistAccount } from '../db_models.generated.dto';
import type {
  CheckoutSessionRequest,
  CheckoutSessionResponse,
  PlanChangeRequest,
  PlanChangeResponse,
  VatInvoiceDetailsRequest,
  VatInvoiceDetailsResponse,
} from '../../domain/user-and-account/account-checkout.types';

export type ACCOUNT_DTO_API_V1 = {
  /** Zmienia wyświetlaną nazwę (display_name) konta stylistki; zwraca zaktualizowane konto. */
  ACCOUNT_DISPLAY_NAME_CHANGE: {
    REQUEST: Pick<StylistAccount, 'display_name'>;
    RESPONSE: StylistAccount;
    RESPONSE_ERROR: DetailedErrorPayload<
      ACCOUNT_DTO_API_V1['ACCOUNT_DISPLAY_NAME_CHANGE']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      ACCOUNT_DTO_API_V1['ACCOUNT_DISPLAY_NAME_CHANGE']['REQUEST'],
      ACCOUNT_DTO_API_V1['ACCOUNT_DISPLAY_NAME_CHANGE']['RESPONSE'],
      ACCOUNT_DTO_API_V1['ACCOUNT_DISPLAY_NAME_CHANGE']['RESPONSE_ERROR']
    >;
  };

  /** Zwraca listę stylistek z lokalizacją w promieniu (radius_km) od podanych współrzędnych, do wyszukiwania i mapy w pobliżu. */
  ACCOUNT_GET_STYLISTS_WITH_LOCATION: {
    REQUEST: {
      latitude?: number;
      longitude?: number;
      radius_km?: number;
    };
    RESPONSE: Array<{
      account_id: string;
      business_name: string | null;
      address_city: string | null;
      latitude: number;
      longitude: number;
      display_name: string | null;
      gallery_count: number;
    }>;
    RESPONSE_ERROR: DetailedErrorPayload<
      ACCOUNT_DTO_API_V1['ACCOUNT_GET_STYLISTS_WITH_LOCATION']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      ACCOUNT_DTO_API_V1['ACCOUNT_GET_STYLISTS_WITH_LOCATION']['REQUEST'],
      ACCOUNT_DTO_API_V1['ACCOUNT_GET_STYLISTS_WITH_LOCATION']['RESPONSE'],
      ACCOUNT_DTO_API_V1['ACCOUNT_GET_STYLISTS_WITH_LOCATION']['RESPONSE_ERROR']
    >;
  };

  /**
   * UPDATE_STYLIST_PROFILE — D5 (run 25 TRD) consolidated endpoint.
   *
   * Replaces 3 prior commands (SET_LOCATION, SET_VANITY_URL, UPDATE_STYLIST_SOCIAL_LINKS)
   * with a single atomic mutation. Each sub-section is OPTIONAL — frontend sends only
   * dirty sections. Backend wraps all updates in a single Prisma `$transaction` —
   * either all succeed, or none persist.
   *
   * Sub-sections:
   *  - location: business_name + address + phone + website + description (geocoded)
   *  - vanity:   vanity_url (unique, reserved-words checked)
   *  - social:   instagram_handle (sanitized)
   */
  UPDATE_STYLIST_PROFILE: {
    REQUEST: {
      location?: Pick<
        StylistAccount,
        | 'business_name'
        | 'address_street'
        | 'address_city'
        | 'address_postal_code'
        | 'address_country'
        | 'phone'
        | 'website'
        | 'description'
      >;
      vanity?: Pick<StylistAccount, 'vanity_url'>;
      social?: {
        instagram_handle?: string | null;
      };
      /** Branding-light (krok 1): kolor akcentu profilu — hex z kuratorowanej
       *  palety kernela (branding.config), null = powrót do domyślnego.
       *  Gate planu can_brand_profile (Pro Marka+). */
      branding?: {
        brand_accent_color: string | null;
      };
    };
    RESPONSE: {
      account_id: StylistAccount['account_id'];
      updated_sections: Array<'location' | 'vanity' | 'social' | 'branding'>;
      address_city: StylistAccount['address_city'];
      latitude: StylistAccount['latitude'];
      longitude: StylistAccount['longitude'];
      business_name: StylistAccount['business_name'];
      vanity_url: StylistAccount['vanity_url'];
      instagram_handle: StylistAccount['instagram_handle'];
      brand_accent_color: StylistAccount['brand_accent_color'];
    };
    RESPONSE_ERROR: DetailedErrorPayload<{
      location: string;
      vanity_url: string;
      instagram_handle: string;
      brand_accent_color: string;
    }>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      ACCOUNT_DTO_API_V1['UPDATE_STYLIST_PROFILE']['REQUEST'],
      ACCOUNT_DTO_API_V1['UPDATE_STYLIST_PROFILE']['RESPONSE'],
      ACCOUNT_DTO_API_V1['UPDATE_STYLIST_PROFILE']['RESPONSE_ERROR']
    >;
  };

  /**
   * ACCOUNT_SET_AVATAR — zdjęcie profilowe stylistki (upload i usunięcie).
   *
   * `avatar_url` = adres assetu wgranego wcześniej PROSTO do Cloudinary przez
   * przeglądarkę (tak samo jak galeria i zdjęcia efektu wizyty); backend
   * zapisuje wyłącznie adres, nie przyjmuje
   * bajtów. `null` = wyczyszczenie kolumny, czyli powrót do łańcucha fallbacku
   * `created_by_user.image` (OAuth) → inicjały w interfejsie.
   *
   * RESPONSE oddaje WARTOŚĆ KOLUMNY, nie wynik fallbacku — front i tak
   * unieważnia `queryKeys.account.current`, a mieszanie tych dwóch rzeczy
   * kazałoby zgadywać, czy „jest avatar" znaczy „własny" czy „z Google".
   */
  ACCOUNT_SET_AVATAR: {
    REQUEST: { avatar_url: string | null };
    RESPONSE: {
      account_id: StylistAccount['account_id'];
      avatar_url: StylistAccount['avatar_url'];
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      ACCOUNT_DTO_API_V1['ACCOUNT_SET_AVATAR']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      ACCOUNT_DTO_API_V1['ACCOUNT_SET_AVATAR']['REQUEST'],
      ACCOUNT_DTO_API_V1['ACCOUNT_SET_AVATAR']['RESPONSE'],
      ACCOUNT_DTO_API_V1['ACCOUNT_SET_AVATAR']['RESPONSE_ERROR']
    >;
  };

  /**
   * ACCOUNT_DISMISS_GALLERY_STRENGTH — stylistka zamyka kartę „Siła galerii".
   *
   * Bez treści w żądaniu: konto bierzemy z sesji, a data zamknięcia powstaje
   * na serwerze. Jednokierunkowe — nic tego znacznika nie czyści, bo o
   * pokazaniu karty decyduje WYNIK (spadek poniżej 100% przywraca kartę mimo
   * znacznika).
   */
  ACCOUNT_DISMISS_GALLERY_STRENGTH: {
    REQUEST: Record<string, never>;
    RESPONSE: {
      account_id: StylistAccount['account_id'];
      gallery_strength_dismissed_at: string;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      ACCOUNT_DTO_API_V1['ACCOUNT_DISMISS_GALLERY_STRENGTH']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      ACCOUNT_DTO_API_V1['ACCOUNT_DISMISS_GALLERY_STRENGTH']['REQUEST'],
      ACCOUNT_DTO_API_V1['ACCOUNT_DISMISS_GALLERY_STRENGTH']['RESPONSE'],
      ACCOUNT_DTO_API_V1['ACCOUNT_DISMISS_GALLERY_STRENGTH']['RESPONSE_ERROR']
    >;
  };

  /** Zwraca publiczny profil stylistki po identyfikatorze (vanity_url lub id) wraz z licznikami galerii, zakładek i polubień. */
  ACCOUNT_GET_PUBLIC_PROFILE: {
    REQUEST: {
      identifier: string;
    };
    RESPONSE: {
      account: Pick<
        StylistAccount,
        | 'account_id'
        | 'display_name'
        | 'business_name'
        | 'address_city'
        | 'address_country'
        | 'phone'
        | 'website'
        | 'description'
        | 'vanity_url'
        | 'view_count'
        | 'instagram_handle'
        | 'avatar_url'
        | 'brand_accent_color'
      >;
      gallery_records_count: number;
      bookmark_count: number;
      total_likes: number;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      ACCOUNT_DTO_API_V1['ACCOUNT_GET_PUBLIC_PROFILE']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      ACCOUNT_DTO_API_V1['ACCOUNT_GET_PUBLIC_PROFILE']['REQUEST'],
      ACCOUNT_DTO_API_V1['ACCOUNT_GET_PUBLIC_PROFILE']['RESPONSE'],
      ACCOUNT_DTO_API_V1['ACCOUNT_GET_PUBLIC_PROFILE']['RESPONSE_ERROR']
    >;
  };

  /** Tworzy sesję portalu rozliczeniowego Stripe dla zalogowanego użytkownika; zwraca URL do zarządzania subskrypcją. */
  ACCOUNT_STRIPE_PORTAL: {
    REQUEST: undefined;
    RESPONSE: { url: string };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      undefined,
      { url: string },
      DetailedErrorPayload<undefined>
    >;
  };

  // SPE: dispatcher wyboru planu. RESPONSE = discriminated union (account-checkout.types).
  ACCOUNT_CHECKOUT_SESSION: {
    REQUEST: CheckoutSessionRequest;
    RESPONSE: CheckoutSessionResponse;
    RESPONSE_ERROR: DetailedErrorPayload<
      ACCOUNT_DTO_API_V1['ACCOUNT_CHECKOUT_SESSION']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      ACCOUNT_DTO_API_V1['ACCOUNT_CHECKOUT_SESSION']['REQUEST'],
      ACCOUNT_DTO_API_V1['ACCOUNT_CHECKOUT_SESSION']['RESPONSE'],
      ACCOUNT_DTO_API_V1['ACCOUNT_CHECKOUT_SESSION']['RESPONSE_ERROR']
    >;
  };

  // Faktura VAT: zapis danych firmowych (name/adres/NIP) na Stripe Customer PRZED
  // confirm() — subform opcjonalny (B2B chce faktury z własnym NIP). RESPONSE={ok:true}.
  ACCOUNT_VAT_INVOICE_DETAILS: {
    REQUEST: VatInvoiceDetailsRequest;
    RESPONSE: VatInvoiceDetailsResponse;
    RESPONSE_ERROR: DetailedErrorPayload<
      ACCOUNT_DTO_API_V1['ACCOUNT_VAT_INVOICE_DETAILS']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      ACCOUNT_DTO_API_V1['ACCOUNT_VAT_INVOICE_DETAILS']['REQUEST'],
      ACCOUNT_DTO_API_V1['ACCOUNT_VAT_INVOICE_DETAILS']['RESPONSE'],
      ACCOUNT_DTO_API_V1['ACCOUNT_VAT_INVOICE_DETAILS']['RESPONSE_ERROR']
    >;
  };

  // SPE: zmiana planu paid->paid (proracja + SCA inline).
  ACCOUNT_PLAN_CHANGE: {
    REQUEST: PlanChangeRequest;
    RESPONSE: PlanChangeResponse;
    RESPONSE_ERROR: DetailedErrorPayload<
      ACCOUNT_DTO_API_V1['ACCOUNT_PLAN_CHANGE']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      ACCOUNT_DTO_API_V1['ACCOUNT_PLAN_CHANGE']['REQUEST'],
      ACCOUNT_DTO_API_V1['ACCOUNT_PLAN_CHANGE']['RESPONSE'],
      ACCOUNT_DTO_API_V1['ACCOUNT_PLAN_CHANGE']['RESPONSE_ERROR']
    >;
  };

  /** Zlicza wyświetlenie profilu stylistki (stylist_account_id), pomijając wejścia właściciela; zwraca aktualny licznik view_count. */
  ACCOUNT_INCREMENT_VIEW: {
    REQUEST: { stylist_account_id: string };
    RESPONSE: { view_count: number };
    RESPONSE_ERROR: DetailedErrorPayload<
      ACCOUNT_DTO_API_V1['ACCOUNT_INCREMENT_VIEW']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      ACCOUNT_DTO_API_V1['ACCOUNT_INCREMENT_VIEW']['REQUEST'],
      ACCOUNT_DTO_API_V1['ACCOUNT_INCREMENT_VIEW']['RESPONSE'],
      ACCOUNT_DTO_API_V1['ACCOUNT_INCREMENT_VIEW']['RESPONSE_ERROR']
    >;
  };

  // === ACCOUNT_GET_DASHBOARD_FEED ===
  /** Zwraca dane pulpitu stylistki: statystyki (wyświetlenia, aktywne pary, oczekujące udostępnienia, polubienia) i ostatnie rekordy galerii. */
  ACCOUNT_GET_DASHBOARD_FEED: {
    REQUEST: undefined;
    RESPONSE: {
      gallery_strength_score: number;
      /** Karta „Siła galerii" zamknięta przez stylistkę (znacznik w bazie). */
      gallery_strength_dismissed: boolean;
      total_views: number;
      active_pairs_count: number;
      pending_shares_count: number;
      recent_bookmarks_count: number;
      recent_gallery_records: Array<{
        gallery_record_id: string;
        image_url: string;
        created_at: string;
      }>;
      // === Extended dashboard stats ===
      photo_count: number;
      /**
       * Widoczne prace PRZYPIĘTE do wizytówki publicznej.
       *
       * DECISION (nie usuwaj tego komentarza) — owner 2026-09-09: to jest miara
       * kroku „wizytówka gotowa" w samouczku aktywacji. Świadomie NIE jest tym
       * samym co `photo_count` (`cached_gallery_count`, cała widoczna galeria):
       * o tym, co widzi klientka na profilu publicznym, decyduje WYŁĄCZNIE
       * przypięcie, więc dodanie zdjęcia do galerii nie zalicza tego kroku.
       */
      pinned_count: number;
      like_count: number;
      paired_client_count: number;
      member_since: string;
      profile_view_count: number;
    };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      undefined,
      ACCOUNT_DTO_API_V1['ACCOUNT_GET_DASHBOARD_FEED']['RESPONSE'],
      ACCOUNT_DTO_API_V1['ACCOUNT_GET_DASHBOARD_FEED']['RESPONSE_ERROR']
    >;
  };

  /** Zapisuje osobistą notatkę na pulpicie dla danego typu konta (account_type); wartość null czyści notatkę. */
  ACCOUNT_SET_DASHBOARD_NOTE: {
    REQUEST: { note: string | null; account_type: AccountType };
    RESPONSE: { dashboard_note: string | null };
    RESPONSE_ERROR: DetailedErrorPayload<
      ACCOUNT_DTO_API_V1['ACCOUNT_SET_DASHBOARD_NOTE']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      ACCOUNT_DTO_API_V1['ACCOUNT_SET_DASHBOARD_NOTE']['REQUEST'],
      ACCOUNT_DTO_API_V1['ACCOUNT_SET_DASHBOARD_NOTE']['RESPONSE'],
      ACCOUNT_DTO_API_V1['ACCOUNT_SET_DASHBOARD_NOTE']['RESPONSE_ERROR']
    >;
  };

  /** Zwraca notatki pulpitu zalogowanego użytkownika, osobno dla strony stylistki i klientki. */
  ACCOUNT_GET_DASHBOARD_NOTE: {
    REQUEST: undefined;
    RESPONSE: { stylist_note: string | null; client_note: string | null };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      undefined,
      ACCOUNT_DTO_API_V1['ACCOUNT_GET_DASHBOARD_NOTE']['RESPONSE'],
      ACCOUNT_DTO_API_V1['ACCOUNT_GET_DASHBOARD_NOTE']['RESPONSE_ERROR']
    >;
  };
};
