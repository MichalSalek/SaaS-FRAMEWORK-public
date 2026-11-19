import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';

export type GalleryPinnedDtoApi = {
  /** Sets the order of pinned works on the stylist's profile card: the full list of ids of her visible pinned works in the new order. */
  GALLERY_REORDER_PINNED_RECORDS: {
    REQUEST: {
      gallery_record_ids: string[];
    };
    RESPONSE: {
      success: boolean;
      gallery_record_ids: string[];
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      GalleryPinnedDtoApi['GALLERY_REORDER_PINNED_RECORDS']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      GalleryPinnedDtoApi['GALLERY_REORDER_PINNED_RECORDS']['REQUEST'],
      GalleryPinnedDtoApi['GALLERY_REORDER_PINNED_RECORDS']['RESPONSE'],
      GalleryPinnedDtoApi['GALLERY_REORDER_PINNED_RECORDS']['RESPONSE_ERROR']
    >;
  };

  /** Returns the visible pinned works of the stylist's own gallery in profile-card order (pin manager). */
  GALLERY_GET_PINNED_RECORDS: {
    REQUEST: undefined;
    RESPONSE: {
      records: Array<{
        gallery_record_id: string;
        asset_url: string;
      }>;
    };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      undefined,
      GalleryPinnedDtoApi['GALLERY_GET_PINNED_RECORDS']['RESPONSE'],
      GalleryPinnedDtoApi['GALLERY_GET_PINNED_RECORDS']['RESPONSE_ERROR']
    >;
  };
};
