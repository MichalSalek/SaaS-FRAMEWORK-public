import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type {
  FavoriteGalleryRecord,
  FavoriteStylist,
} from '../db_models.generated.dto';
import type { TraitCategory } from '../db_models.manual.dto';

export type FAVORITE_DTO_API_V1 = {
  /** Klientka dodaje stylistkę do zapisanych (zwraca id utworzonego wpisu). */
  BOOKMARK_STYLIST: {
    REQUEST: Pick<FavoriteStylist, 'stylist_account_id'>;
    RESPONSE: Pick<
      FavoriteStylist,
      'id' | 'client_user_id' | 'stylist_account_id'
    >;
    RESPONSE_ERROR: DetailedErrorPayload<
      FAVORITE_DTO_API_V1['BOOKMARK_STYLIST']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      FAVORITE_DTO_API_V1['BOOKMARK_STYLIST']['REQUEST'],
      FAVORITE_DTO_API_V1['BOOKMARK_STYLIST']['RESPONSE'],
      FAVORITE_DTO_API_V1['BOOKMARK_STYLIST']['RESPONSE_ERROR']
    >;
  };

  /** Klientka usuwa stylistkę z zapisanych. */
  UNBOOKMARK_STYLIST: {
    REQUEST: Pick<FavoriteStylist, 'stylist_account_id'>;
    RESPONSE: { success: boolean };
    RESPONSE_ERROR: DetailedErrorPayload<
      FAVORITE_DTO_API_V1['UNBOOKMARK_STYLIST']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      FAVORITE_DTO_API_V1['UNBOOKMARK_STYLIST']['REQUEST'],
      FAVORITE_DTO_API_V1['UNBOOKMARK_STYLIST']['RESPONSE'],
      FAVORITE_DTO_API_V1['UNBOOKMARK_STYLIST']['RESPONSE_ERROR']
    >;
  };

  /** Stronicowana lista zapisanych stylistek klientki (nazwa, miasto, liczba prac, flaga sparowania). */
  GET_BOOKMARKED_STYLISTS: {
    REQUEST: { cursor?: string; take?: number } | undefined;
    RESPONSE: {
      records: Array<{
        id: string;
        stylist_account_id: string;
        business_name: string | null;
        address_city: string | null;
        display_name: string | null;
        gallery_count: number;
        is_paired: boolean;
        bookmarked_at: string;
      }>;
      nextCursor: string | null;
    };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      FAVORITE_DTO_API_V1['GET_BOOKMARKED_STYLISTS']['REQUEST'],
      FAVORITE_DTO_API_V1['GET_BOOKMARKED_STYLISTS']['RESPONSE'],
      FAVORITE_DTO_API_V1['GET_BOOKMARKED_STYLISTS']['RESPONSE_ERROR']
    >;
  };

  /** Klientka zapisuje pojedynczą pracę z galerii do ulubionych (opcjonalna notatka). */
  FAVORITE_ADD_RECORD: {
    REQUEST: Pick<FavoriteGalleryRecord, 'gallery_record_id'> & {
      note?: string | null;
    };
    RESPONSE: Pick<
      FavoriteGalleryRecord,
      'id' | 'client_user_id' | 'gallery_record_id' | 'note'
    >;
    RESPONSE_ERROR: DetailedErrorPayload<
      FAVORITE_DTO_API_V1['FAVORITE_ADD_RECORD']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      FAVORITE_DTO_API_V1['FAVORITE_ADD_RECORD']['REQUEST'],
      FAVORITE_DTO_API_V1['FAVORITE_ADD_RECORD']['RESPONSE'],
      FAVORITE_DTO_API_V1['FAVORITE_ADD_RECORD']['RESPONSE_ERROR']
    >;
  };

  /** Klientka usuwa pracę z galerii z ulubionych. */
  FAVORITE_REMOVE_RECORD: {
    REQUEST: Pick<FavoriteGalleryRecord, 'gallery_record_id'>;
    RESPONSE: { success: boolean };
    RESPONSE_ERROR: DetailedErrorPayload<
      FAVORITE_DTO_API_V1['FAVORITE_REMOVE_RECORD']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      FAVORITE_DTO_API_V1['FAVORITE_REMOVE_RECORD']['REQUEST'],
      FAVORITE_DTO_API_V1['FAVORITE_REMOVE_RECORD']['RESPONSE'],
      FAVORITE_DTO_API_V1['FAVORITE_REMOVE_RECORD']['RESPONSE_ERROR']
    >;
  };

  /** Stronicowana płaska lista ulubionych prac z detalami (kolory, cechy, stylistka, notatka). */
  FAVORITE_GET_RECORDS: {
    REQUEST: { cursor?: string; take?: number } | undefined;
    RESPONSE: {
      records: Array<{
        id: string;
        gallery_record_id: string;
        asset_url: string;
        colors: Array<{ id: string; name: string; hex_code: string }>;
        traits: Array<{
          id: string;
          name: string;
          category: TraitCategory;
          icon_url: string | null;
          is_featured: boolean;
        }>;
        stylist_account_id: string;
        stylist_display_name: string | null;
        note: string | null;
      }>;
      nextCursor: string | null;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      { cursor?: string; take?: number } | undefined
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      FAVORITE_DTO_API_V1['FAVORITE_GET_RECORDS']['REQUEST'],
      FAVORITE_DTO_API_V1['FAVORITE_GET_RECORDS']['RESPONSE'],
      FAVORITE_DTO_API_V1['FAVORITE_GET_RECORDS']['RESPONSE_ERROR']
    >;
  };

  /** Aktualizuje notatkę klientki przy ulubionej pracy z galerii. */
  FAVORITE_UPDATE_RECORD_NOTE: {
    REQUEST: { gallery_record_id: string; note: string | null };
    RESPONSE: { gallery_record_id: string; note: string | null };
    RESPONSE_ERROR: DetailedErrorPayload<
      FAVORITE_DTO_API_V1['FAVORITE_UPDATE_RECORD_NOTE']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      FAVORITE_DTO_API_V1['FAVORITE_UPDATE_RECORD_NOTE']['REQUEST'],
      FAVORITE_DTO_API_V1['FAVORITE_UPDATE_RECORD_NOTE']['RESPONSE'],
      FAVORITE_DTO_API_V1['FAVORITE_UPDATE_RECORD_NOTE']['RESPONSE_ERROR']
    >;
  };

  /** Ulubione prace pogrupowane po stylistce (liczba i kilka ostatnich miniatur). */
  FAVORITE_GET_GROUPED: {
    REQUEST: undefined;
    RESPONSE: {
      groups: Array<{
        stylist_account_id: string;
        stylist_display_name: string | null;
        stylist_profile_image_url: string | null;
        favorites_count: number;
        recent_favorites: Array<{
          favorite_id: string;
          gallery_record_id: string;
          image_url: string;
          created_at: string;
        }>;
      }>;
    };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      FAVORITE_DTO_API_V1['FAVORITE_GET_GROUPED']['REQUEST'],
      FAVORITE_DTO_API_V1['FAVORITE_GET_GROUPED']['RESPONSE'],
      FAVORITE_DTO_API_V1['FAVORITE_GET_GROUPED']['RESPONSE_ERROR']
    >;
  };
};
