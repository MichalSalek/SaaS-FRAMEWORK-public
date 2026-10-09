import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type { NailLength } from '../../domain/gallery/nail-length.config';
import type {
  ColorDTO,
  TraitDTO,
  TraitCategory,
} from '../db_models.manual.dto';

export type GALLERY_DTO_API_V1 = {
  /** Tworzy nowy rekord galerii stylistki z URL assetu, kolorami, cechami i długością paznokci; zwraca id rekordu. */
  CREATE_GALLERY_RECORD: {
    REQUEST: {
      asset_url: string;
      color_ids: string[];
      trait_ids: string[];
      nail_length: NailLength;
    };
    RESPONSE: { gallery_record_id: string };
    RESPONSE_ERROR: DetailedErrorPayload<
      GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['REQUEST'],
      GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['RESPONSE'],
      GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['RESPONSE_ERROR']
    >;
  };

  /** Lista rekordów własnej galerii stylistki z filtrem kolory/cechy i stronicowaniem kursorowym; flaga is_pinned per rekord. */
  GET_GALLERY_RECORDS: {
    REQUEST: {
      gallery_record_id?: string | undefined;
      color_ids: string[];
      trait_ids: string[];
      apply_strict_filter: boolean;
      cursor?: string | undefined;
      take?: number | undefined;
    };
    RESPONSE: {
      records: Array<{
        gallery_record_id: string;
        asset_url: string;
        nail_length: NailLength;
        is_pinned: boolean;
        colors: ColorDTO[];
        traits: TraitDTO[];
        created_at: string | Date;
      }>;
      nextCursor: string | null;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      GALLERY_DTO_API_V1['GET_GALLERY_RECORDS']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      GALLERY_DTO_API_V1['GET_GALLERY_RECORDS']['REQUEST'],
      GALLERY_DTO_API_V1['GET_GALLERY_RECORDS']['RESPONSE'],
      GALLERY_DTO_API_V1['GET_GALLERY_RECORDS']['RESPONSE_ERROR']
    >;
  };

  /** Usuwa asset u zewnętrznego dostawcy (Cloudinary) bez czyszczenia rekordu w bazie; anulowanie uploadu w trakcie (stylistka). */
  DELETE_ASSET_FROM_VENDOR: {
    REQUEST: {
      asset_id: string; // string not IDType, because is external service.
    };
    RESPONSE: undefined;
    RESPONSE_ERROR: DetailedErrorPayload<
      GALLERY_DTO_API_V1['DELETE_ASSET_FROM_VENDOR']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      GALLERY_DTO_API_V1['DELETE_ASSET_FROM_VENDOR']['REQUEST'],
      GALLERY_DTO_API_V1['DELETE_ASSET_FROM_VENDOR']['RESPONSE'],
      GALLERY_DTO_API_V1['DELETE_ASSET_FROM_VENDOR']['RESPONSE_ERROR']
    >;
  };

  /** Aktualizuje kolory, cechy lub długość paznokci istniejącego rekordu galerii; zwraca zaktualizowany rekord. */
  UPDATE_GALLERY_RECORD: {
    REQUEST: {
      gallery_record_id: string;
      color_ids?: string[];
      trait_ids?: string[];
      nail_length?: NailLength;
    };
    RESPONSE: {
      gallery_record_id: string;
      nail_length: NailLength;
      colors: ColorDTO[];
      traits: TraitDTO[];
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      GALLERY_DTO_API_V1['UPDATE_GALLERY_RECORD']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      GALLERY_DTO_API_V1['UPDATE_GALLERY_RECORD']['REQUEST'],
      GALLERY_DTO_API_V1['UPDATE_GALLERY_RECORD']['RESPONSE'],
      GALLERY_DTO_API_V1['UPDATE_GALLERY_RECORD']['RESPONSE_ERROR']
    >;
  };

  /** Usuwa rekord galerii po id (rekord w bazie plus asynchroniczne czyszczenie assetu); zwraca flagę success i id. */
  DELETE_GALLERY_RECORD: {
    REQUEST: {
      gallery_record_id: string;
    };
    RESPONSE: {
      success: boolean;
      gallery_record_id: string;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      GALLERY_DTO_API_V1['DELETE_GALLERY_RECORD']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      GALLERY_DTO_API_V1['DELETE_GALLERY_RECORD']['REQUEST'],
      GALLERY_DTO_API_V1['DELETE_GALLERY_RECORD']['RESPONSE'],
      GALLERY_DTO_API_V1['DELETE_GALLERY_RECORD']['RESPONSE_ERROR']
    >;
  };

  /** Zwraca pojedynczy rekord galerii po id z danymi stylistki oraz flagami is_favorited/is_pinned dla bieżącego użytkownika. */
  GET_GALLERY_RECORD_BY_ID: {
    REQUEST: {
      gallery_record_id: string;
    };
    RESPONSE: {
      gallery_record: {
        gallery_record_id: string;
        asset_url: string;
        nail_length: NailLength;
        colors: ColorDTO[];
        traits: TraitDTO[];
        created_at: string | Date;
      };
      stylist_info: {
        account_id: string;
        display_name: string | null;
        business_name: string | null;
        address_city: string | null;
      };
      is_favorited: boolean;
      /** true if current user has this record pinned/favorited:
       *  - for stylist (owner): whether the record is_pinned on their gallery
       *  - for client: whether the record is in their favorites
       */
      is_pinned: boolean;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      GALLERY_DTO_API_V1['GET_GALLERY_RECORD_BY_ID']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      GALLERY_DTO_API_V1['GET_GALLERY_RECORD_BY_ID']['REQUEST'],
      GALLERY_DTO_API_V1['GET_GALLERY_RECORD_BY_ID']['RESPONSE'],
      GALLERY_DTO_API_V1['GET_GALLERY_RECORD_BY_ID']['RESPONSE_ERROR']
    >;
  };

  /** Publiczna lista rekordów galerii konta (bez logowania) z paginacją limit/offset i filtrami kolory/cechy; dane stylistki i znak wodny. */
  PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT: {
    REQUEST: {
      account_id: string;
      limit?: number;
      offset?: number;
      color_ids?: string[];
      trait_ids?: string[];
    };
    RESPONSE: {
      records: Array<{
        gallery_record_id: string;
        asset_url: string;
        nail_length: NailLength;
        colors: ColorDTO[];
        traits: TraitDTO[];
        created_at: string | Date;
      }>;
      total_count: number;
      show_watermark: boolean;
      stylist_info: {
        account_id: string;
        display_name: string | null;
        business_name: string | null;
        address_city: string | null;
        // Branding-light krok 2 (2026-07-12): kolor marki na coverze galerii
        // publicznej. null gdy brak LUB plan bez can_brand_profile (maska na
        // read, jak public profile — write-gate nie czyści kolumny). SSOT:
        // domain/user-and-account/branding.config.ts.
        brand_accent_color: string | null;
      };
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      GALLERY_DTO_API_V1['PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      GALLERY_DTO_API_V1['PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT']['REQUEST'],
      GALLERY_DTO_API_V1['PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT']['RESPONSE'],
      GALLERY_DTO_API_V1['PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT']['RESPONSE_ERROR']
    >;
  };

  /** Przypina (wyróżnia) rekord w galerii stylistki, limit zależny od planu; zwraca success i liczbę przypiętych. */
  GALLERY_PIN_RECORD: {
    REQUEST: {
      gallery_record_id: string;
    };
    RESPONSE: {
      success: boolean;
      pinned_count: number;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      GALLERY_DTO_API_V1['GALLERY_PIN_RECORD']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      GALLERY_DTO_API_V1['GALLERY_PIN_RECORD']['REQUEST'],
      GALLERY_DTO_API_V1['GALLERY_PIN_RECORD']['RESPONSE'],
      GALLERY_DTO_API_V1['GALLERY_PIN_RECORD']['RESPONSE_ERROR']
    >;
  };

  /** Odpina wcześniej przypięty rekord galerii stylistki; zwraca success i liczbę przypiętych. */
  GALLERY_UNPIN_RECORD: {
    REQUEST: {
      gallery_record_id: string;
    };
    RESPONSE: {
      success: boolean;
      pinned_count: number;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      GALLERY_DTO_API_V1['GALLERY_UNPIN_RECORD']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      GALLERY_DTO_API_V1['GALLERY_UNPIN_RECORD']['REQUEST'],
      GALLERY_DTO_API_V1['GALLERY_UNPIN_RECORD']['RESPONSE'],
      GALLERY_DTO_API_V1['GALLERY_UNPIN_RECORD']['RESPONSE_ERROR']
    >;
  };

  /** Zwraca pełną listę dostępnych kolorów (słownik) do filtrów i tagowania rekordów galerii. */
  GET_COLORS: {
    REQUEST: undefined;
    RESPONSE: ColorDTO[];
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      undefined,
      GALLERY_DTO_API_V1['GET_COLORS']['RESPONSE'],
      GALLERY_DTO_API_V1['GET_COLORS']['RESPONSE_ERROR']
    >;
  };

  /** Zwraca listę cech (opcjonalnie z jednej kategorii) do filtrów i tagowania rekordów galerii. */
  GET_TRAITS: {
    REQUEST: {
      category?: TraitCategory;
    };
    RESPONSE: TraitDTO[];
    RESPONSE_ERROR: DetailedErrorPayload<
      GALLERY_DTO_API_V1['GET_TRAITS']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      GALLERY_DTO_API_V1['GET_TRAITS']['REQUEST'],
      GALLERY_DTO_API_V1['GET_TRAITS']['RESPONSE'],
      GALLERY_DTO_API_V1['GET_TRAITS']['RESPONSE_ERROR']
    >;
  };

  /** Publiczna lista profili (identyfikator plus data aktualizacji) do generowania sitemapy. */
  PUBLIC_GET_SITEMAP_PROFILES: {
    REQUEST: Record<string, never>;
    RESPONSE: {
      profiles: Array<{
        identifier: string;
        updated_at: string;
      }>;
    };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      Record<string, never>,
      GALLERY_DTO_API_V1['PUBLIC_GET_SITEMAP_PROFILES']['RESPONSE'],
      GALLERY_DTO_API_V1['PUBLIC_GET_SITEMAP_PROFILES']['RESPONSE_ERROR']
    >;
  };

  /** Pełna galeria wskazanej stylistki dla połączonej z nią klientki, z paginacją; zwraca rekordy, licznik i dane stylistki. */
  GALLERY_GET_FOR_PAIRED_CLIENT: {
    REQUEST: {
      stylist_account_id: string;
      limit?: number;
      offset?: number;
    };
    RESPONSE: {
      records: Array<{
        gallery_record_id: string;
        asset_url: string;
        nail_length: NailLength;
        is_pinned: boolean;
        colors: ColorDTO[];
        traits: TraitDTO[];
        created_at: string | Date;
      }>;
      total_count: number;
      stylist_info: {
        account_id: string;
        display_name: string | null;
        business_name: string | null;
        address_city: string | null;
        // Branding-light krok 2 (2026-07-12): kolor marki na coverze pełnej
        // galerii połączonej klientki. Maska planu na read (jak wyżej).
        brand_accent_color: string | null;
      };
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      GALLERY_DTO_API_V1['GALLERY_GET_FOR_PAIRED_CLIENT']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      GALLERY_DTO_API_V1['GALLERY_GET_FOR_PAIRED_CLIENT']['REQUEST'],
      GALLERY_DTO_API_V1['GALLERY_GET_FOR_PAIRED_CLIENT']['RESPONSE'],
      GALLERY_DTO_API_V1['GALLERY_GET_FOR_PAIRED_CLIENT']['RESPONSE_ERROR']
    >;
  };

  /** Feed odkrywania rekordów galerii wielu stylistek (za feature flagą), z filtrami kolory/cechy/długość/miasto/szukaj i kursorem. */
  EXPLORE_GALLERY_RECORDS: {
    REQUEST: {
      color_ids?: string[];
      trait_ids?: string[];
      nail_length?: NailLength;
      apply_strict_filter?: boolean;
      cursor?: string;
      take?: number;
      city?: string;
      searchQuery?: string;
    };
    RESPONSE: {
      records: Array<{
        gallery_record_id: string;
        asset_url: string;
        nail_length: NailLength;
        is_pinned: boolean;
        colors: ColorDTO[];
        traits: TraitDTO[];
        created_at: string | Date;
        like_count: number;
        is_favorited: boolean;
        show_watermark: boolean;
        created_by_account: {
          account_id: string;
          display_name: string | null;
          vanity_url: string | null;
          address_city: string | null;
        };
      }>;
      nextCursor: string | null;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      GALLERY_DTO_API_V1['EXPLORE_GALLERY_RECORDS']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      GALLERY_DTO_API_V1['EXPLORE_GALLERY_RECORDS']['REQUEST'],
      GALLERY_DTO_API_V1['EXPLORE_GALLERY_RECORDS']['RESPONSE'],
      GALLERY_DTO_API_V1['EXPLORE_GALLERY_RECORDS']['RESPONSE_ERROR']
    >;
  };
};
