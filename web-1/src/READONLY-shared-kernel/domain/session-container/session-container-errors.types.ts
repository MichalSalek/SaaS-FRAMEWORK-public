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

/**
 * The first photo of a stylist-less session would give it a stylist with whom
 * the client already has ANOTHER open session (one open session per pair,
 * index `session_container_active_pair_uq`; a draft counts). Not a limit: the
 * way out is that open session (`existingSessionId`, null when the collision
 * came from the index and the winner could not be read back).
 */
export type SessionContainerPairSessionExistsError = {
  type: 'SESSION_CONTAINER_PAIR_SESSION_EXISTS';
  sessionId: string;
  stylistAccountId: string;
  existingSessionId: string | null;
};

export type SessionContainerError =
  | SessionContainerNotFoundError
  | SessionContainerNotAuthorizedError
  | SessionContainerNotPairedError
  | SessionContainerMaxActiveExceededError
  | SessionContainerInvalidStateError
  | SessionContainerEmptyError
  | SessionContainerPhotoOwnershipError
  | SessionContainerShareQuotaExceededError
  | SessionContainerPairSessionExistsError;
