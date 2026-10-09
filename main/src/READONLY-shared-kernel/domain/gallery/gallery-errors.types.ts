import type { PricingPlan } from '../pricing/pricing.config';

export type GalleryRecordNotFoundError = {
  type: 'GALLERY_RECORD_NOT_FOUND';
  recordId: string;
};

export type GalleryLimitReachedError = {
  type: 'GALLERY_LIMIT_REACHED';
  currentCount: number;
  limit: number;
  planType: PricingPlan;
};

export type GalleryRecordOwnershipError = {
  type: 'GALLERY_RECORD_OWNERSHIP_ERROR';
  recordId: string;
  ownerId: string;
  requesterId: string;
};

export type GalleryPinLimitReachedError = {
  type: 'GALLERY_PIN_LIMIT_REACHED';
  currentPinned: number;
  limit: number;
};

export type GalleryRecordAlreadyPinnedError = {
  type: 'GALLERY_RECORD_ALREADY_PINNED';
  recordId: string;
};

export type GalleryRecordNotPinnedError = {
  type: 'GALLERY_RECORD_NOT_PINNED';
  recordId: string;
};

export type GalleryError =
  | GalleryRecordNotFoundError
  | GalleryLimitReachedError
  | GalleryRecordOwnershipError
  | GalleryPinLimitReachedError
  | GalleryRecordAlreadyPinnedError
  | GalleryRecordNotPinnedError;
