import { resolvePersonAvatarUrl } from '@kernel/domain/user/avatar.policy';
/**
 * SessionContainer QUERY operations (R8)
 *
 * Queries: getMy, getById
 */

import { DB_CLIENT } from '@app/db/db.client';
import { markSessionViewed } from './session-viewed.operations';
import {
  canAcceptSession,
  sessionStylistRelationshipWhere,
} from '../session-activity.access';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';
import type {
  SessionContainerDTO,
  SessionContainerDetailDTO,
} from '@kernel/models/session-container/session-container.dto';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  SessionContainerNotAuthorizedError,
  SessionContainerNotFoundError,
} from '@kernel/domain/session-container/session-container-errors.types';
import type {
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import { isP2025 } from '@app/db/prisma-error';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { isValidCursorFormat } from '@kernel/policies/validation/validation.utils';
import type { Prisma } from '../../../prisma/js-client';
import {
  mapSessionToDTO,
  mapSessionToDetailDTO,
  toDtoLifecycleState,
  resolveViewerSide,
  SHARED_STATES_FOR_PRISMA,
  CLIENT_NAME_INCLUDE,
  type PhotoWithOptionalGalleryRecord,
  type SessionRowWithClient,
  type SessionViewerSide,
} from './session-container-shared.operations';

// ─── 5. GET MY ────────────────────────────────────────────────────────────

/**
 * Get my session containers with cursor pagination (default 50, max 100).
 * Cursor by SessionContainer.id; orderBy id desc for stable cursor traversal.
 */
export const getMySessionContainers_IO = async ({
  client_account_id,
  stylist_account_id,
  cursor,
  take = 50,
}: {
  client_account_id: string | undefined;
  stylist_account_id: string | undefined;
  cursor?: string;
  take?: number;
}): Promise<
  OperationResult<
    { sessions: SessionContainerDTO[]; nextCursor: string | null },
    DatabaseError | ValidationError
  >
> => {
  const now = new Date();
  const effectiveTake = Math.min(Math.max(take, 1), 100);

  // Viewer's own-set filter (client: all their sessions; stylist: only SHARED/ACTIVE
  // not-expired). Built ONCE and reused for BOTH the cursor existence pre-check and the
  // main list query, so the two cannot drift (SSOT within the function).
  const viewerOr: Prisma.SessionContainerWhereInput[] = [
    ...(client_account_id ? [{ client_account_id }] : []),
    ...(stylist_account_id
      ? [
          {
            stylist_account_id,
            ...sessionStylistRelationshipWhere(stylist_account_id),
            lifecycle_state: { in: [...SHARED_STATES_FOR_PRISMA] },
            OR: [{ expires_at: null }, { expires_at: { gt: now } }],
          },
        ]
      : []),
  ];

  // DECISION: uniform cursor contract. (1) Format gate: a null byte or non-cuid cursor would throw in Prisma as an unmapped
  // 500; isValidCursorFormat (@kernel) returns VALIDATION_ERROR 400. (2) The existence pre-check is SCOPED to the caller's set
  // (findFirst {id: cursor, OR: viewerOr}, the SAME filter as the main query): findMany for a stale cursor returns an EMPTY set
  // (no P2025), so without it 200 + sessions:[] is indistinguishable from the end of the list.
  // The scope (not a bare findUnique by PK) closes the existence oracle: a foreign live cursor id and a nonexistent cuid both
  // give VALIDATION_ERROR 400. Same as the sibling PRIVATE lists getSupportThreads_IO (resolveSupportThreadCursor),
  // getMyPairs_IO and getClientVisits_IO. Do NOT copy it to the PUBLIC feeds (gallery-explore, gallery-list,
  // public-stylists-list), which are unscoped on purpose: their ids are public and a row hidden mid-scroll is still a valid
  // `skip:1` anchor; here the data is PRIVATE, so anti-enumeration wins.
  // Tradeoff: on the STYLIST path viewerOr contains lifecycle IN SHARED_STATES + expires_at > now, so a session that expires or
  // changes state BETWEEN two page fetches makes its cursor stale => 400 "Invalid cursor". That is the same handled stale-cursor
  // contract the frontend answers by refetching from page one, a window of seconds against a session TTL of hours or days. The
  // CLIENT path ({client_account_id}, no volatile conditions) is fully stable. The P2025 branch in the catch below stays as a
  // harmless fallback.
  if (cursor !== undefined) {
    if (!isValidCursorFormat(cursor)) {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'cursor',
        message: 'Invalid cursor',
      });
    }
    try {
      const cursorRow = await DB_CLIENT.use.sessionContainer.findFirst({
        where: { id: cursor, OR: viewerOr },
        select: { id: true },
      });
      if (!cursorRow) {
        return failure({
          type: 'VALIDATION_ERROR',
          field: 'cursor',
          message: 'Invalid cursor',
        });
      }
    } catch (error) {
      return databaseFailure('getMySessionContainers_IO:cursorCheck', error);
    }
  }

  try {
    // Gather sessions for client (all their sessions) and stylist (only SHARED/ACTIVE not expired)
    const sessions = await DB_CLIENT.use.sessionContainer.findMany({
      where: { OR: viewerOr },
      orderBy: [{ id: 'desc' }],
      take: effectiveTake + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        _count: { select: { photos: true } },
        // Hydrate the owning client's display name so the stylist inbox shows
        // WHO shared each session (SSOT include — mirrors loadSessionDetail_IO).
        ...CLIENT_NAME_INCLUDE,
      },
    });

    const hasMore = sessions.length > effectiveTake;
    const pageItems = hasMore ? sessions.slice(0, effectiveTake) : sessions;
    const nextCursor =
      hasMore && pageItems.length > 0
        ? (pageItems[pageItems.length - 1]?.id ?? null)
        : null;

    return success({
      // Per-row viewer-side masking: a get-my caller may be the owning client of
      // some rows AND the assigned stylist of others (the OR query above mixes
      // both). stylistNote is revealed only on rows where THIS reader is the
      // assigned stylist; on her own client-owned rows it is masked
      // (DOMAIN_SSOT §3.2 — stylist-private). See resolveViewerSide.
      sessions: pageItems.map(s => {
        const row = s as SessionRowWithClient;
        return mapSessionToDTO(
          row,
          s._count.photos,
          resolveViewerSide({
            sessionStylistAccountId: row.stylist_account_id ?? null,
            viewerStylistAccountId: stylist_account_id,
          })
        );
      }),
      nextCursor,
    });
  } catch (error) {
    // DECISION: stale-cursor handling lives in the pre-check at the top of this function; this
    // P2025 branch is only a defensive fallback (see
    // web-1/src/domain/gallery/operations/gallery-explore.query.ts).
    if (isP2025(error)) {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'cursor',
        message: 'Invalid cursor',
      });
    }
    return databaseFailure('getMySessionContainers_IO', error);
  }
};

// ─── 6. GET BY ID ─────────────────────────────────────────────────────────

export const loadSessionDetail_IO = async (
  session_id: string,
  // DECISION: viewerSide is OPTIONAL and DEFAULTS to masking stylistNote (=> 'client'). add-photo calls loadSessionDetail
  // without it and is a client-only path (requireClientAccount), so the default masking is right there. stylistNote is revealed
  // ONLY from get-by-id, once the reader is confirmed as the assigned stylist (viewerSide==='stylist').
  viewerSide?: SessionViewerSide,
  tx?: Prisma.TransactionClient
): Promise<
  OperationResult<
    SessionContainerDetailDTO,
    SessionContainerNotFoundError | DatabaseError
  >
> => {
  // DECISION: the function is wrapped in try/catch. It used to have none, so DB errors threw instead of returning a failure
  // result and left consumer call sites (addPhotoToSessionContainer_IO) with uncaught rejections. The return type now includes
  // DatabaseError; consumers handle DATABASE_ERROR via mapErrorToResponse (already exhaustive in error-mapper).
  try {
    const [session, photosWithRecord, totalPhotoCount] = await Promise.all([
      (tx ?? DB_CLIENT.use).sessionContainer.findUnique({
        where: { id: session_id },
        // Hydrate the owning client's display name (SSOT include) so the stylist
        // detail view credits the sender by name — mirrors getMySessionContainers_IO.
        include: CLIENT_NAME_INCLUDE,
      }),
      (tx ?? DB_CLIENT.use).sessionContainerPhoto.findMany({
        where: { session_id },
        orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
        // DECISION: photos are capped at 200 per session, a pre-launch limit (typically <50). If MVP users exceed it, add a
        // `has_more` indicator + pagination. SESSION_CONTAINER_CONFIG has no SESSION_MAX_PHOTOS: this is a runtime cap, not a
        // business rule.
        take: 200,
      }),
      // DECISION: photoCount is counted INDEPENDENTLY of the take:200 cap above, so detail reports the same number as get-my
      // (_count.photos, uncapped). Otherwise a session of >200 photos would show 200 in detail and the real number in the list. A
      // cheap count() instead of deriving from the truncated array.
      (tx ?? DB_CLIENT.use).sessionContainerPhoto.count({
        where: { session_id },
      }),
    ]);

    // Hydrate gallery records (single batch read)
    const galleryRecordIds = photosWithRecord.map(p => p.gallery_record_id);
    const records = galleryRecordIds.length
      ? await (tx ?? DB_CLIENT.use).galleryRecord.findMany({
          where: { gallery_record_id: { in: galleryRecordIds } },
          select: {
            gallery_record_id: true,
            asset_url: true,
            nail_length: true,
            is_pinned: true,
            created_by_account_id: true,
            created_by_account: {
              select: {
                display_name: true,
                business_name: true,
                created_by_user: { select: { avatar_url: true, image: true } },
                vanity_url: true,
                account_id: true,
              },
            },
            // is_hidden is loaded for masking and stripped below so it never
            // reaches gallery_record_data or the DTO.
            is_hidden: true,
          },
          take: 200,
        })
      : [];
    const recordMap = new Map(records.map(r => [r.gallery_record_id, r]));

    if (!session) {
      return failure({
        type: 'SESSION_CONTAINER_NOT_FOUND',
        sessionId: session_id,
      });
    }

    // DECISION: a moderation-hidden record is masked for the client (read side), same as gallery-detail (is_hidden masked for
    // non-owners) and favorite. EVERY session record belongs to the session's stylist (add-photo enforces ownership), so the
    // "stylist viewer" == owner and sees her own hidden content (owner bypass); the client (default/'client') gets
    // gallery_record_data === null. It is the backstop for hide-AFTER-add: add-photo already rejects hidden records on entry, but a
    // record added legitimately and later taken down must disappear from the client's session too. is_hidden is stripped
    // explicitly (recData without it), or it would leak into galleryRecord in the DTO.
    const maskHidden = viewerSide !== 'stylist';
    const photos: PhotoWithOptionalGalleryRecord[] = photosWithRecord.map(p => {
      const rec = recordMap.get(p.gallery_record_id);
      if (
        !rec ||
        ((maskHidden ||
          rec.created_by_account_id !== session.stylist_account_id) &&
          rec.is_hidden)
      ) {
        return { ...p, gallery_record_data: null };
      }
      return {
        ...p,
        gallery_record_data: {
          gallery_record_id: rec.gallery_record_id,
          asset_url: rec.asset_url,
          nail_length: rec.nail_length,
          is_pinned: rec.is_pinned,
          created_by_account_id: rec.created_by_account_id,
          author: {
            name:
              rec.created_by_account.display_name ??
              rec.created_by_account.business_name ??
              '',
            avatar_url: resolvePersonAvatarUrl(
              rec.created_by_account.created_by_user
            ),
            identifier:
              rec.created_by_account.vanity_url ??
              rec.created_by_account.account_id,
          },
        },
      };
    });

    return success(
      mapSessionToDetailDTO(session, photos, totalPhotoCount, viewerSide)
    );
  } catch (error) {
    return databaseFailure('loadSessionDetail', error);
  }
};

export const getSessionContainerById_IO = async ({
  session_id,
  client_account_id,
  stylist_account_id,
  user_id,
}: {
  session_id: string;
  client_account_id: string | undefined;
  stylist_account_id: string | undefined;
  user_id: string;
}): Promise<
  OperationResult<
    SessionContainerDetailDTO,
    | SessionContainerNotFoundError
    | SessionContainerNotAuthorizedError
    | DatabaseError
  >
> => {
  let session;
  try {
    session = await DB_CLIENT.use.sessionContainer.findUnique({
      where: { id: session_id },
      select: {
        id: true,
        client_account_id: true,
        stylist_account_id: true,
        lifecycle_state: true,
        expires_at: true,
        viewed_at: true,
        // shared_at: null = container was NEVER shared to the assigned stylist.
        // Needed by the SCCAP-3 terminal-never-shared guard below (session-close-edge).
        shared_at: true,
      },
    });
  } catch (error) {
    return databaseFailure('getSessionContainerById', error);
  }

  if (!session) {
    return failure({
      type: 'SESSION_CONTAINER_NOT_FOUND',
      sessionId: session_id,
    });
  }

  const isOwningClient =
    Boolean(client_account_id) &&
    session.client_account_id === client_account_id;
  const isAssignedStylist =
    Boolean(stylist_account_id) &&
    session.stylist_account_id === stylist_account_id;

  if (!isOwningClient && !isAssignedStylist) {
    return failure({
      type: 'SESSION_CONTAINER_NOT_AUTHORIZED',
      sessionId: session_id,
      userId: user_id,
    });
  }

  // Stylist may NOT see DRAFT/READY (those are client-private)
  if (isAssignedStylist && !isOwningClient) {
    try {
      const permitted = await DB_CLIENT.use.sessionContainer.count({
        where: {
          id: session_id,
          ...sessionStylistRelationshipWhere(stylist_account_id ?? ''),
        },
      });
      if (!permitted) {
        return failure({
          type: 'SESSION_CONTAINER_NOT_AUTHORIZED',
          sessionId: session_id,
          userId: user_id,
        });
      }
    } catch (error) {
      return databaseFailure('getSessionContainerById:relationship', error);
    }
    const state = toDtoLifecycleState(session.lifecycle_state);
    if (
      state === SessionContainerLifecycleStateValue.DRAFT ||
      state === SessionContainerLifecycleStateValue.READY
    ) {
      return failure({
        type: 'SESSION_CONTAINER_NOT_AUTHORIZED',
        sessionId: session_id,
        userId: user_id,
      });
    }
  }

  // DECISION: terminal never-shared guard. The DRAFT/READY guard above covers pre-share states; this closes the post-terminal
  // hole: when an owner CLOSES (or lets EXPIRE) a container assigned to a stylist but NEVER shared (shared_at === null), it lands
  // in CLOSED/EXPIRED with shared_at still null and would fall through to loadSessionDetail_IO, leaking name + clientNote to the
  // assigned-but-never-shared stylist. "Assigned" != "shared": a container shared THEN closed (shared_at set) stays readable as
  // the stylist's CRM archive (DOMAIN_SSOT §3.2). Reaching this point the state is non-DRAFT/READY, so shared_at === null <=>
  // terminal-never-shared. The owner bypasses (isOwningClient). Mirrored in closeSessionContainer_IO and the set-note op.
  if (isAssignedStylist && !isOwningClient && session.shared_at === null) {
    return failure({
      type: 'SESSION_CONTAINER_NOT_AUTHORIZED',
      sessionId: session_id,
      userId: user_id,
    });
  }

  // Read-side field authorization: reveal stylistNote ONLY to the assigned
  // stylist (DOMAIN_SSOT §3.2 — stylist-private). The owning client (incl. the
  // case where she reads a session she also happens to be paired on) gets it
  // masked. The DRAFT/READY-for-stylist case was already rejected above, so a
  // 'stylist' viewerSide here only ever sees SHARED/ACTIVE — but resolveViewerSide
  // keys off ownership, not state, which is the correct invariant.
  // DECISION: isOwningClient takes precedence: if (in the extreme) the reader is both the owning client and the assigned stylist
  // of the same session, she is treated as the client (mask), because client ownership is the privileged access path (she sees
  // DRAFT/READY); stylistNote stays her private note only in the stylist role.
  const viewerSide: SessionViewerSide =
    !isOwningClient && isAssignedStylist
      ? resolveViewerSide({
          sessionStylistAccountId: session.stylist_account_id,
          viewerStylistAccountId: stylist_account_id,
        })
      : 'client';

  // Mark the first stylist read. Best effort: a failed status write must not
  // make an authorized session unreadable; the next open retries. The client
  // sees „Obejrzana” while acceptance remains a separate, explicit action.
  if (viewerSide === 'stylist') {
    await markSessionViewed(session_id, session.viewed_at);
  }

  // loadSessionDetail_IO now returns DatabaseError on DB failure (DD2-A4) —
  // no need for an outer try/catch.
  const detail = await loadSessionDetail_IO(session_id, viewerSide);
  if (!detail.success) {
    return detail;
  }
  try {
    return success({
      ...detail.data,
      can_accept: await canAcceptSession(
        detail.data,
        stylist_account_id,
        viewerSide === 'stylist'
      ),
    });
  } catch (error) {
    return databaseFailure('getSessionContainerById:acceptPermission', error);
  }
};
