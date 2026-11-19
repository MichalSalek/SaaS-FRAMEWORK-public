// Gallery errors (kernel `GalleryError`).
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { GalleryError } from '@kernel/domain/gallery/gallery-errors.types';
import {
  respondBadRequest,
  respondConflict,
  respondForbidden,
  respondNotFound,
} from '../http.responses.utils';
import type { ErrorResponderMap, OwnErrors } from './error-map.types';
import { respondPlanLimit } from './shared.responders';

export const galleryErrorMap = {
  GALLERY_RECORD_NOT_FOUND: (res, error) =>
    respondNotFound(res, APP_EVENTS.INFO.GALLERY.CANNOT_GET_GALLERY_RECORD, {
      recordId: error.recordId,
    }),

  GALLERY_LIMIT_REACHED: respondPlanLimit,

  GALLERY_RECORD_OWNERSHIP_ERROR: (res, error) =>
    respondForbidden(res, {
      recordId: error.recordId,
    }),

  GALLERY_PIN_LIMIT_REACHED: (res, error) =>
    respondForbidden(
      res,
      { currentPinned: error.currentPinned, limit: error.limit },
      APP_EVENTS.INFO.GALLERY.GALLERY_PIN_LIMIT_REACHED
    ),

  GALLERY_RECORD_ALREADY_PINNED: (res, error) =>
    respondBadRequest(
      res,
      APP_EVENTS.INFO.GALLERY.GALLERY_RECORD_ALREADY_PINNED,
      { recordId: error.recordId }
    ),

  GALLERY_RECORD_NOT_PINNED: (res, error) =>
    respondBadRequest(res, APP_EVENTS.INFO.GALLERY.GALLERY_RECORD_NOT_PINNED, {
      recordId: error.recordId,
    }),

  // 409: the request was well formed, but the list no longer matches the stylist's pinned set
  // (another tab pinned or unpinned). The client refetches the order.
  GALLERY_PINNED_ORDER_STALE: (res, error) =>
    respondConflict(res, APP_EVENTS.INFO.GALLERY.GALLERY_PINNED_ORDER_STALE, {
      expectedCount: error.expectedCount,
      receivedCount: error.receivedCount,
    }),
} satisfies ErrorResponderMap<OwnErrors<GalleryError>>;
