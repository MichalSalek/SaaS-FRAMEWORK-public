import { defineEndpoint, defineQuery } from '../../application/http/io';
import type { FAVORITE_DTO_API_V1 } from '@kernel/models/favorites/favorite.dto';
import { ENDPOINTS } from '../../application/http/http.endpoints';

// FDX FAZA 2 (W2.2/W2.3): domena `favorites` zmigrowana na unified promise-first
// front-door (`defineEndpoint`/`defineQuery`). Każdy `_IO` zwraca teraz `Promise<Res>` —
// hooki wołają go bezpośrednio (bez `toPromise` przy call-site). Nazwy `_IO` zachowane.
// Patrz DECISION w `application/http/io.ts`.

export const bookmarkStylist_IO = defineEndpoint<
  FAVORITE_DTO_API_V1['BOOKMARK_STYLIST']['REQUEST'],
  FAVORITE_DTO_API_V1['BOOKMARK_STYLIST']['RESPONSE'],
  FAVORITE_DTO_API_V1['BOOKMARK_STYLIST']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.BOOKMARK_STYLIST,
  mode: 'post',
});

export const unbookmarkStylist_IO = defineEndpoint<
  FAVORITE_DTO_API_V1['UNBOOKMARK_STYLIST']['REQUEST'],
  FAVORITE_DTO_API_V1['UNBOOKMARK_STYLIST']['RESPONSE'],
  FAVORITE_DTO_API_V1['UNBOOKMARK_STYLIST']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.UNBOOKMARK_STYLIST,
  mode: 'post',
});

export const getBookmarkedStylists_IO = defineQuery<
  FAVORITE_DTO_API_V1['GET_BOOKMARKED_STYLISTS']['REQUEST'],
  FAVORITE_DTO_API_V1['GET_BOOKMARKED_STYLISTS']['RESPONSE'],
  FAVORITE_DTO_API_V1['GET_BOOKMARKED_STYLISTS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.GET_BOOKMARKED_STYLISTS,
  queryFields: req => ({
    cursor: req?.cursor,
    take: req?.take,
  }),
});

export const addRecordToFavorites_IO = defineEndpoint<
  FAVORITE_DTO_API_V1['FAVORITE_ADD_RECORD']['REQUEST'],
  FAVORITE_DTO_API_V1['FAVORITE_ADD_RECORD']['RESPONSE'],
  FAVORITE_DTO_API_V1['FAVORITE_ADD_RECORD']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.FAVORITE_ADD_RECORD,
  mode: 'post',
});

export const removeRecordFromFavorites_IO = defineEndpoint<
  FAVORITE_DTO_API_V1['FAVORITE_REMOVE_RECORD']['REQUEST'],
  FAVORITE_DTO_API_V1['FAVORITE_REMOVE_RECORD']['RESPONSE'],
  FAVORITE_DTO_API_V1['FAVORITE_REMOVE_RECORD']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.FAVORITE_REMOVE_RECORD,
  mode: 'post',
});

export const getFavoriteRecords_IO = defineQuery<
  FAVORITE_DTO_API_V1['FAVORITE_GET_RECORDS']['REQUEST'],
  FAVORITE_DTO_API_V1['FAVORITE_GET_RECORDS']['RESPONSE'],
  FAVORITE_DTO_API_V1['FAVORITE_GET_RECORDS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.FAVORITE_GET_RECORDS,
  queryFields: req => ({
    cursor: req?.cursor,
    take: req?.take,
  }),
});

export const updateFavoriteRecordNote_IO = defineEndpoint<
  FAVORITE_DTO_API_V1['FAVORITE_UPDATE_RECORD_NOTE']['REQUEST'],
  FAVORITE_DTO_API_V1['FAVORITE_UPDATE_RECORD_NOTE']['RESPONSE'],
  FAVORITE_DTO_API_V1['FAVORITE_UPDATE_RECORD_NOTE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.FAVORITE_UPDATE_RECORD_NOTE,
  mode: 'post',
});

export const getFavoriteGrouped_IO = defineEndpoint<
  FAVORITE_DTO_API_V1['FAVORITE_GET_GROUPED']['REQUEST'],
  FAVORITE_DTO_API_V1['FAVORITE_GET_GROUPED']['RESPONSE'],
  FAVORITE_DTO_API_V1['FAVORITE_GET_GROUPED']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.FAVORITE_GET_GROUPED,
  mode: 'get',
});
