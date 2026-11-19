/**
 * SessionContainer shared helpers (R8)
 *
 * Mappers, constants, and utility functions used by both commands and queries.
 */

import { resolveSalonAccess_IO } from '@domain/pairing/salon-access.resolver';
import { TIME } from '@kernel/application/constants.config';
import { SESSION_CONTAINER_CONFIG } from '@kernel/domain/session-container/session-container.config';
import { countSessionsTowardSharedLimit } from '@kernel/domain/session-container/session-container.limit';
import type { Prisma } from '../../../prisma/js-client';
import {
  SessionContainerLifecycleStateValue,
  type NailLength,
  type SessionContainer as PrismaSessionContainer,
  type SessionContainerLifecycleState,
  type SessionContainerPhoto as PrismaSessionContainerPhoto,
} from '@kernel/models/db_models.generated.dto';
import type {
  SessionContainerDTO,
  SessionContainerDetailDTO,
  SessionContainerPhotoDTO,
} from '@kernel/models/session-container/session-container.dto';

// Constants
const MILLISECONDS_PER_DAY = TIME.MS_PER_DAY;

// ─── Viewer-side field authorization ───────────────────────────────────────

/**
 * Which party is reading the session. Drives read-side field masking of
 * stylist-private fields (currently `stylistNote`).
 */
export type SessionViewerSide = 'stylist' | 'client';

const maskSessionPrivateFields = (
  dto: SessionContainerDTO,
  viewerSide: SessionViewerSide | undefined
): SessionContainerDTO =>
  viewerSide === 'stylist' ? dto : { ...dto, stylistNote: null };

/**
 * Resolve the viewer side for a given session row from the reader's account
 * context. Returns 'stylist' ONLY when the reader is the assigned stylist of
 * THIS session (so stylist-private fields are revealed to her); otherwise
 * 'client' (masked). The reader must already be authorized to read the row —
 * this only decides field visibility, not access.
 *
 * Note: a session's client and stylist are always distinct accounts, so a
 * reader cannot be both the owning client and the assigned stylist of the same
 * row. When in doubt (no stylist match) we default to the masked 'client' side.
 */
export const resolveViewerSide = ({
  sessionStylistAccountId,
  viewerStylistAccountId,
}: {
  sessionStylistAccountId: string | null;
  viewerStylistAccountId: string | undefined;
}): SessionViewerSide =>
  Boolean(viewerStylistAccountId) &&
  sessionStylistAccountId === viewerStylistAccountId
    ? 'stylist'
    : 'client';

// ─── Helpers ──────────────────────────────────────────────────────────────

export const calculateExpiresAt = (sharedAt: Date): Date =>
  new Date(
    sharedAt.getTime() +
      SESSION_CONTAINER_CONFIG.SESSION_EXPIRY_DAYS * MILLISECONDS_PER_DAY
  );

export const toDtoLifecycleState = (
  state: PrismaSessionContainer['lifecycle_state']
): SessionContainerLifecycleState => state as SessionContainerLifecycleState;

// ─── Client name hydration ──────────────────────────────────────────────────

// A session row optionally joined with its owning client's User.name. Read paths
// (get-my / get-by-id / loadSessionDetail) include the relation so the stylist's
// inbox can show WHO shared the session; write paths pass a plain row and the DTO
// falls back to clientName === null. The relation shape is OPTIONAL at every level
// so a bare PrismaSessionContainer is still assignable (no call-site churn).
export type SessionRowWithClient = PrismaSessionContainer & {
  client_account?: {
    created_by_user_id?: string;
    created_by_user?: { name: string | null } | null;
  } | null;
};

export const CLIENT_NAME_INCLUDE = {
  client_account: {
    select: {
      created_by_user_id: true,
      created_by_user: { select: { name: true } },
    },
  },
} as const;

const resolveClientName = (session: SessionRowWithClient): string | null => {
  const raw = session.client_account?.created_by_user?.name;
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

export const mapSessionToDTO = (
  session: SessionRowWithClient,
  photoCount: number,
  viewerSide?: SessionViewerSide
): SessionContainerDTO =>
  maskSessionPrivateFields(
    {
      id: session.id,
      clientAccountId: session.client_account_id,
      clientName: resolveClientName(session),
      clientUserId: session.client_account?.created_by_user_id ?? null,
      stylistAccountId: session.stylist_account_id ?? null,
      name: session.name ?? null,
      lifecycleState: toDtoLifecycleState(session.lifecycle_state),
      stylistNote: session.stylist_note ?? null,
      clientNote: session.client_note ?? null,
      sharedAt: session.shared_at
        ? new Date(session.shared_at).toISOString()
        : null,
      accepted_at: session.accepted_at
        ? new Date(session.accepted_at).toISOString()
        : null,
      viewed_at: session.viewed_at
        ? new Date(session.viewed_at).toISOString()
        : null,
      last_client_change_at: session.last_client_change_at
        ? new Date(session.last_client_change_at).toISOString()
        : null,
      expiresAt: session.expires_at
        ? new Date(session.expires_at).toISOString()
        : null,
      closedAt: session.closed_at
        ? new Date(session.closed_at).toISOString()
        : null,
      createdAt: new Date(session.created_at).toISOString(),
      updatedAt: new Date(session.updated_at).toISOString(),
      photoCount,
    },
    viewerSide
  );

export type PhotoWithOptionalGalleryRecord = PrismaSessionContainerPhoto & {
  gallery_record_data?: {
    gallery_record_id: string;
    asset_url: string;
    nail_length: NailLength;
    is_pinned: boolean;
    created_by_account_id: string;
    author?: { name: string; avatar_url: string | null; identifier: string };
  } | null;
};

export const mapPhotoToDTO = (
  photo: PhotoWithOptionalGalleryRecord
): SessionContainerPhotoDTO => ({
  id: photo.id,
  sessionId: photo.session_id,
  galleryRecordId: photo.gallery_record_id,
  position: photo.position,
  createdAt: new Date(photo.created_at).toISOString(),
  ...(photo.gallery_record_data
    ? { galleryRecord: photo.gallery_record_data }
    : {}),
});

export const mapSessionToDetailDTO = (
  session: SessionRowWithClient,
  photos: PhotoWithOptionalGalleryRecord[],
  // DECISION: photoCount is passed EXPLICITLY (a total, independent count), NOT derived from photos.length. photos is capped at
  // take:200 in loadSessionDetail_IO while get-my reports the true _count.photos; otherwise detail for a >200-photo session would
  // show 200 and the list the real number (a mismatch and "vanishing" last photos). There is no business cap SESSION_MAX_PHOTOS,
  // so both must count the same.
  photoCount: number,
  viewerSide?: SessionViewerSide
): SessionContainerDetailDTO => ({
  ...mapSessionToDTO(session, photoCount, viewerSide),
  photos: photos
    .slice()
    .sort(
      (a, b) =>
        a.position - b.position ||
        a.created_at.getTime() - b.created_at.getTime()
    )
    .map(mapPhotoToDTO),
});

export const isClosedOrExpired = (
  state: SessionContainerLifecycleState
): boolean =>
  state === SessionContainerLifecycleStateValue.CLOSED ||
  state === SessionContainerLifecycleStateValue.EXPIRED;

export const isShareableState = (
  state: SessionContainerLifecycleState
): boolean =>
  state === SessionContainerLifecycleStateValue.DRAFT ||
  state === SessionContainerLifecycleStateValue.READY;

// DECISION: write-side TTL parity. A SHARED/ACTIVE session with expires_at <= now that the session-container-expiry-interceptor
// has not yet swept (throttle ~6h) is EFFECTIVELY terminal although lifecycle_state is still !== EXPIRED. The read side
// (getMySessionContainers_IO) and create/share (the notExpiredFilter) already mirror that; the write paths add-photo/set-note
// MUST too, or a client keeps adding photos/notes to an expired session for up to ~6h. null = no TTL (DRAFT/READY never expire)
// -> false. A point-in-time check (Date.now()), since the write path holds a fresh row (not a Prisma WHERE like the count guards).
export const isPastTtl = (expiresAt: Date | null): boolean =>
  expiresAt !== null && new Date(expiresAt).getTime() <= Date.now();

export const SHARED_STATES_FOR_PRISMA = [
  SessionContainerLifecycleStateValue.SHARED,
  SessionContainerLifecycleStateValue.ACTIVE,
] as const;

/**
 * Shared sessions of this client that occupy a slot of the shared-session limit (rule: kernel `session-container.limit.ts`).
 * Sessions with stylists reached through a salon do not count. Expired-but-unswept sessions do not count either (mirrors the
 * read-side expiry filter).
 */
export const countSessionsTowardSharedLimit_IO = async (
  tx: Prisma.TransactionClient,
  clientUserId: string,
  clientAccountId: string
): Promise<number> => {
  const now = new Date();
  const sessions = await tx.sessionContainer.findMany({
    where: {
      client_account_id: clientAccountId,
      lifecycle_state: { in: [...SHARED_STATES_FOR_PRISMA] },
      OR: [{ expires_at: null }, { expires_at: { gt: now } }],
    },
    select: { stylist_account_id: true },
    take: 500,
  });
  const stylistIds = sessions.flatMap(s =>
    s.stylist_account_id === null ? [] : [s.stylist_account_id]
  );
  if (stylistIds.length === 0) {
    return sessions.length;
  }
  const salonPairs = await tx.clientStylistPair.findMany({
    where: {
      client_user_id: clientUserId,
      stylist_account_id: { in: stylistIds },
      salon_origin_account_id: { not: null },
    },
    select: { stylist_account_id: true },
    take: 500,
  });
  return countSessionsTowardSharedLimit(
    sessions.map(s => ({
      stylistAccountId: s.stylist_account_id,
      isShared: true,
    })),
    new Set(salonPairs.map(p => p.stylist_account_id))
  );
};

/** True when the stylist is reached only through a salon (outside the limit). */
export const isSalonReachedStylist_IO = async (
  tx: Prisma.TransactionClient,
  clientUserId: string,
  stylistAccountId: string
): Promise<boolean> => {
  const access = await resolveSalonAccess_IO(
    clientUserId,
    stylistAccountId,
    tx
  );
  return access?.kind === 'SALON';
};

// ─── Pairing helper (shared with session-share semantics) ─────────────────

/**
 * Active pairing with a still-visible stylist. Pass `tx` to share the write's snapshot.
 * DECISION: status ACTIVE is not enough. A ban or a soft-delete leaves the pair row
 * ACTIVE, and a write would store photos and notes on the taken-down account.
 * Invisibility in the transaction maps to SESSION_CONTAINER_NOT_PAIRED. Existing
 * sessions stay readable. After re-enable, writes pass again.
 * Test: session-container-add-photo.operation.test.ts (revoked pairing inside the
 * transaction; not a live race).
 */
export const findActivePairing = async (
  client_user_id: string,
  stylist_account_id: string,
  tx?: Prisma.TransactionClient
) => {
  const access = await resolveSalonAccess_IO(
    client_user_id,
    stylist_account_id,
    tx
  );
  return access ? { id: access.pairId } : null;
};
