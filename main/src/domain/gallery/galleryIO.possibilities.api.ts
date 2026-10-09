import { ENV_VARS } from '../../application/environment/environment.config';
import { reportIssueFrontend } from '../../application/error-debugger/errorHandler.possibilities.api';
import { defineEndpoint, defineQuery } from '../../application/http/io';
import { ENDPOINTS } from '../../application/http/http.endpoints';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import {
  CLOUDINARY_UPLOAD_FLAGS,
  CLOUDINARY_UPLOAD_URL,
  cloudinaryUploadPreset,
} from './cloudinary-adapter/cloudinary.config';
import type { CloudinaryType } from './cloudinary-adapter/cloudinary.types';

// Cloudinary `delete_by_token` endpoint (sibling of the upload URL). Built inline
// here (not in cloudinary.config) to keep the draft-discard wiring contained.
const CLOUDINARY_DELETE_BY_TOKEN_URL = (cloudName: string) =>
  `https://api.cloudinary.com/v1_1/${cloudName}/delete_by_token` as const;

// FDX FAZA 2 (W2.2/W2.3): domena `gallery` zmigrowana na unified promise-first
// front-door (`defineEndpoint` / `defineQuery`). Każdy `_IO` zwraca teraz `Promise<Res>` —
// hooki wołają go bezpośrednio (bez `toPromise` przy call-site). Nazwy `_IO` zachowane.

// 60s timeout for Cloudinary image uploads — longer than DEFAULT_REQUEST_TIMEOUT_MS (30s)
// because large multi-MB images on slow mobile connections legitimately exceed 30s.
const CLOUDINARY_UPLOAD_TIMEOUT_MS = 60_000;

// DECISION (nie usuwaj tego komentarza):
// `uploadAssetToVendor_IO` to raw `fetch()` do Cloudinary — vendor upload poza
// frontendu callHTTPEndpoint (brak interceptora, własny 60s AbortController, własny error
// handler). Nie migrujemy na defineEndpoint — zapis `{ req, successCallback, errorCallback }`
// jest ŚWIADOMĄ izolacją vendor-fetch od wewnętrznego transportu. Patrz EXCEPTIONS
// w `application/http/io.ts` DECISION-comment.
export const uploadAssetToVendor_IO = async ({
  req,
  successCallback,
  errorCallback,
}: {
  req: FormData;
  successCallback: (response: CloudinaryType) => void;
  errorCallback: (error: unknown) => void;
}) => {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(
    () => timeoutController.abort(),
    CLOUDINARY_UPLOAD_TIMEOUT_MS
  );

  try {
    const response = await fetch(
      CLOUDINARY_UPLOAD_URL(ENV_VARS.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME),
      { method: 'POST', body: req, signal: timeoutController.signal }
    );
    const data = (await response.json()) as CloudinaryType;
    if (response.ok) {
      successCallback(data);
    } else {
      reportIssueFrontend({
        namespace: 'uploadPhotoAsset_IO',
        message: `error.`,
        payload: data,
        mode: 'error',
      });
      errorCallback(data);
    }
  } catch (e) {
    reportIssueFrontend({
      namespace: 'uploadPhotoAsset_IO',
      message: `error.`,
      payload: e,
      mode: 'error',
    });
    errorCallback(e);
  } finally {
    clearTimeout(timeoutId);
  }
};

/**
 * Promise-first front-door do uploadu obrazka: składa `FormData` (preset, folder,
 * flagi EXIF) i zwraca odpowiedź dostawcy.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Ten sam blok składania `FormData` stał wcześniej w KAŻDYM hooku uploadu (galeria,
 * zdjęcie efektu wizyty), a zdjęcie profilowe stylistki było trzecim kandydatem na
 * kopiuj-wklej — czyli momentem, w którym trzy kopie zaczynają się rozjeżdżać.
 * Rozjazd nie byłby kosmetyczny: `flags: strip_profile` zdejmuje z pliku EXIF
 * (GPS, model telefonu, data), więc kopia, która by o nim zapomniała, publikowałaby
 * współrzędne mieszkania stylistki. Ustawienia uploadu mają jedno miejsce.
 *
 * `uploadAssetToVendor_IO` (callbackowy, izolowany vendor-fetch z własnym timeoutem)
 * ZOSTAJE bez zmian jako warstwa transportu — patrz DECISION przy nim.
 */
export const uploadImageToVendor_IO = async (
  file: File
): Promise<CloudinaryType> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', cloudinaryUploadPreset);
  formData.append(
    'folder',
    ENV_VARS.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || 'nailfolio'
  );
  formData.append('flags', CLOUDINARY_UPLOAD_FLAGS);
  // DECISION (nie usuwaj tego komentarza):
  // `return_delete_token` NIE idzie jako parametr requestu: dostawca odrzuca
  // wtedy cały upload (400). Token zależy od konfiguracji uploadu po stronie
  // dostawcy; odczyt `delete_token ?? null` u wołających obsługuje oba stany
  // (brak tokenu = cleanup no-op, upload działa).

  return new Promise<CloudinaryType>((resolve, reject) => {
    void uploadAssetToVendor_IO({
      req: formData,
      successCallback: resolve,
      errorCallback: reject,
    });
  });
};

// DECISION (nie usuwaj tego komentarza):
// Draft-cancel cleanup. `delete_by_token` to endpoint dostawcy autoryzowany
// samym `delete_token` (zwracanym przy uploadzie; ważny ~10 min, scope = JEDEN
// świeży asset). Dzięki
// temu kasujemy porzucony asset CLIENT-SIDE bez backendowego "any stylist deletes
// any public_id" (brak sekretu, brak ryzyka usunięcia cudzego zdjęcia). To raw
// vendor-fetch — ta sama świadoma izolacja co `uploadAssetToVendor_IO` (poza
// callHTTPEndpoint). Best-effort: zwraca boolean, NIE rzuca (cleanup nie może
// wywrócić unmountu/nawigacji); błąd raportujemy jako 'warn'.
export const deleteAssetByToken_IO = async (
  deleteToken: string
): Promise<boolean> => {
  try {
    const body = new FormData();
    body.append('token', deleteToken);

    const response = await fetch(
      CLOUDINARY_DELETE_BY_TOKEN_URL(
        ENV_VARS.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
      ),
      { method: 'POST', body }
    );

    if (response.ok) {
      return true;
    }

    reportIssueFrontend({
      namespace: 'deleteAssetByToken_IO',
      message: 'Cloudinary delete_by_token returned a non-ok response.',
      payload: { status: response.status },
      mode: 'warn',
    });
    return false;
  } catch (e) {
    reportIssueFrontend({
      namespace: 'deleteAssetByToken_IO',
      message: 'Cloudinary delete_by_token threw.',
      payload: e,
      mode: 'warn',
    });
    return false;
  }
};

export const createGalleryRecord_IO = defineEndpoint<
  GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['REQUEST'],
  GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['RESPONSE'],
  GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.CREATE_GALLERY_RECORD,
  mode: 'post',
});

export const getGalleryRecords_IO = defineQuery<
  GALLERY_DTO_API_V1['GET_GALLERY_RECORDS']['REQUEST'],
  GALLERY_DTO_API_V1['GET_GALLERY_RECORDS']['RESPONSE'],
  GALLERY_DTO_API_V1['GET_GALLERY_RECORDS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.GET_GALLERY_RECORDS,
  queryFields: req => ({
    gallery_record_id: req.gallery_record_id,
    color_ids: req.color_ids,
    trait_ids: req.trait_ids,
    apply_strict_filter: req.apply_strict_filter,
    cursor: req.cursor,
    take: req.take,
  }),
});

export const updateGalleryRecord_IO = defineEndpoint<
  GALLERY_DTO_API_V1['UPDATE_GALLERY_RECORD']['REQUEST'],
  GALLERY_DTO_API_V1['UPDATE_GALLERY_RECORD']['RESPONSE'],
  GALLERY_DTO_API_V1['UPDATE_GALLERY_RECORD']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.UPDATE_GALLERY_RECORD,
  mode: 'post',
});

export const deleteGalleryRecord_IO = defineEndpoint<
  GALLERY_DTO_API_V1['DELETE_GALLERY_RECORD']['REQUEST'],
  GALLERY_DTO_API_V1['DELETE_GALLERY_RECORD']['RESPONSE'],
  GALLERY_DTO_API_V1['DELETE_GALLERY_RECORD']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.DELETE_GALLERY_RECORD,
  mode: 'post',
});

export const getGalleryRecordById_IO = defineQuery<
  GALLERY_DTO_API_V1['GET_GALLERY_RECORD_BY_ID']['REQUEST'],
  GALLERY_DTO_API_V1['GET_GALLERY_RECORD_BY_ID']['RESPONSE'],
  GALLERY_DTO_API_V1['GET_GALLERY_RECORD_BY_ID']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.GET_GALLERY_RECORD_BY_ID,
  queryFields: req => ({ gallery_record_id: req.gallery_record_id }),
});

export const publicGetGalleryRecordsByAccount_IO = defineQuery<
  GALLERY_DTO_API_V1['PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT']['REQUEST'],
  GALLERY_DTO_API_V1['PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT']['RESPONSE'],
  GALLERY_DTO_API_V1['PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT,
  queryFields: req => ({
    account_id: req.account_id,
    limit: req.limit,
    offset: req.offset,
    color_ids: req.color_ids,
    trait_ids: req.trait_ids,
  }),
});

export const galleryPinRecord_IO = defineEndpoint<
  GALLERY_DTO_API_V1['GALLERY_PIN_RECORD']['REQUEST'],
  GALLERY_DTO_API_V1['GALLERY_PIN_RECORD']['RESPONSE'],
  GALLERY_DTO_API_V1['GALLERY_PIN_RECORD']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.GALLERY_PIN_RECORD,
  mode: 'post',
});

export const galleryUnpinRecord_IO = defineEndpoint<
  GALLERY_DTO_API_V1['GALLERY_UNPIN_RECORD']['REQUEST'],
  GALLERY_DTO_API_V1['GALLERY_UNPIN_RECORD']['RESPONSE'],
  GALLERY_DTO_API_V1['GALLERY_UNPIN_RECORD']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.GALLERY_UNPIN_RECORD,
  mode: 'post',
});

export const getColors_IO = defineEndpoint<
  GALLERY_DTO_API_V1['GET_COLORS']['REQUEST'],
  GALLERY_DTO_API_V1['GET_COLORS']['RESPONSE'],
  GALLERY_DTO_API_V1['GET_COLORS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.GET_COLORS,
  mode: 'get',
});

export const getTraits_IO = defineEndpoint<
  GALLERY_DTO_API_V1['GET_TRAITS']['REQUEST'],
  GALLERY_DTO_API_V1['GET_TRAITS']['RESPONSE'],
  GALLERY_DTO_API_V1['GET_TRAITS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.GET_TRAITS,
  mode: 'get',
});

export const galleryGetForPairedClient_IO = defineQuery<
  GALLERY_DTO_API_V1['GALLERY_GET_FOR_PAIRED_CLIENT']['REQUEST'],
  GALLERY_DTO_API_V1['GALLERY_GET_FOR_PAIRED_CLIENT']['RESPONSE'],
  GALLERY_DTO_API_V1['GALLERY_GET_FOR_PAIRED_CLIENT']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.GALLERY_GET_FOR_PAIRED_CLIENT,
  queryFields: req => ({
    stylist_account_id: req.stylist_account_id,
    limit: req.limit,
    offset: req.offset,
  }),
});

export const exploreGalleryRecords_IO = defineQuery<
  GALLERY_DTO_API_V1['EXPLORE_GALLERY_RECORDS']['REQUEST'],
  GALLERY_DTO_API_V1['EXPLORE_GALLERY_RECORDS']['RESPONSE'],
  GALLERY_DTO_API_V1['EXPLORE_GALLERY_RECORDS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.EXPLORE_GALLERY_RECORDS,
  queryFields: req => ({
    color_ids: req.color_ids,
    trait_ids: req.trait_ids,
    nail_length: req.nail_length,
    apply_strict_filter: req.apply_strict_filter,
    cursor: req.cursor,
    take: req.take,
    city: req.city,
    searchQuery: req.searchQuery,
  }),
});
