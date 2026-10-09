/**
 * Session Container domain errors
 *
 * Wired through web-1/src/application/http/error-mapper.ts (exhaustive switch).
 */

export type SessionContainerNotFoundError = {
  type: 'SESSION_CONTAINER_NOT_FOUND';
  sessionId: string;
};

export type SessionContainerNotAuthorizedError = {
  type: 'SESSION_CONTAINER_NOT_AUTHORIZED';
  sessionId: string;
  userId: string;
};

export type SessionContainerNotPairedError = {
  type: 'SESSION_CONTAINER_NOT_PAIRED';
  clientUserId: string;
  stylistAccountId: string;
};

export type SessionContainerMaxActiveExceededError = {
  type: 'SESSION_CONTAINER_MAX_ACTIVE_EXCEEDED';
  // SC-CAP: cap egzekwowana po osi PER-CLIENT (DOMAIN_SSOT §3.2), nie per-stylist.
  clientAccountId: string;
  currentCount: number;
  limit: number;
};

export type SessionContainerInvalidStateError = {
  type: 'SESSION_CONTAINER_INVALID_STATE';
  sessionId: string;
  currentState: string;
  attemptedAction: string;
};

export type SessionContainerEmptyError = {
  type: 'SESSION_CONTAINER_EMPTY';
  sessionId: string;
};

export type SessionContainerShareQuotaExceededError = {
  type: 'SESSION_CONTAINER_SHARE_QUOTA_EXCEEDED';
  stylistAccountId: string;
  currentCount: number;
  limit: number;
};

export type SessionContainerPhotoOwnershipError = {
  type: 'SESSION_CONTAINER_PHOTO_OWNERSHIP';
  sessionId: string;
  galleryRecordId: string;
  expectedStylistAccountId: string;
};

export type SessionContainerError =
  | SessionContainerNotFoundError
  | SessionContainerNotAuthorizedError
  | SessionContainerNotPairedError
  | SessionContainerMaxActiveExceededError
  | SessionContainerInvalidStateError
  | SessionContainerEmptyError
  | SessionContainerPhotoOwnershipError
  | SessionContainerShareQuotaExceededError;
