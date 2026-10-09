import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { writeRawEventLog_IO } from '@app/event-log/event-log.client';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import type {
  AnnouncementDTO,
  AnnouncementType,
} from '@kernel/models/admin/admin.dto';
import {
  assertType,
  isAnnouncementTypeNarrower,
} from '@kernel/models/type_narrowing';
import { DB_CLIENT } from '@app/db/db.client';
import { isP2025 } from '@app/db/prisma-error';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { AdminError } from '@kernel/domain/admin/admin-errors.types';
import type {
  AnnouncementNotFoundError,
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { QUERY_LIMITS } from '@kernel/domain/admin/admin.config';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type {
  ActiveAnnouncementCache,
  CachedActiveAnnouncement,
} from './admin-announcements.helpers';
import {
  announcementCache,
  ANNOUNCEMENT_CACHE_KEY,
  isValidDateRange,
  isWithinTimeWindow,
  toPublicAnnouncement,
  validateAnnouncementDate,
} from './admin-announcements.helpers';

type AnnouncementOperationError =
  AdminError | AnnouncementNotFoundError | DatabaseError | ValidationError;

/**
 * Get all announcements (admin only) — ordered by created_at desc
 */
export const adminGetAnnouncements_IO = async ({
  currentUser,
}: {
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<OperationResult<AnnouncementDTO[], AnnouncementOperationError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  try {
    const announcements = await DB_CLIENT.use.announcement.findMany({
      orderBy: { created_at: 'desc' },
      take: QUERY_LIMITS.ADMIN_LIST_DEFAULT,
    });

    const result: AnnouncementDTO[] = announcements.map(a => ({
      id: a.id,
      title: a.title,
      message: a.message,
      type: assertType(a.type, isAnnouncementTypeNarrower, 'AnnouncementType'),
      is_active: a.is_active,
      starts_at: a.starts_at ? a.starts_at.toISOString() : null,
      ends_at: a.ends_at ? a.ends_at.toISOString() : null,
      created_by_user_id: a.created_by_user_id,
      created_at: a.created_at.toISOString(),
    }));

    return success(result);
  } catch (error) {
    return databaseFailure('adminGetAnnouncements_IO', error);
  }
};

/**
 * Create new announcement (admin only)
 */
export const adminCreateAnnouncement_IO = async ({
  title,
  message,
  type,
  is_active,
  starts_at,
  ends_at,
  currentUser,
}: {
  title: string;
  message: string;
  type: AnnouncementType;
  is_active: boolean;
  starts_at?: string;
  ends_at?: string;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<OperationResult<{ id: string }, AnnouncementOperationError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  const startsAtError = validateAnnouncementDate(starts_at, 'starts_at');
  if (startsAtError) {
    return failure(startsAtError);
  }
  const endsAtError = validateAnnouncementDate(ends_at, 'ends_at');
  if (endsAtError) {
    return failure(endsAtError);
  }

  if (!isValidDateRange(starts_at, ends_at)) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'ends_at',
      message: 'ends_at must be after starts_at',
    });
  }

  try {
    const created = await DB_CLIENT.use.announcement.create({
      data: {
        title: title.trim(),
        message: message.trim(),
        type,
        is_active,
        ...(starts_at ? { starts_at: new Date(starts_at) } : {}),
        ...(ends_at ? { ends_at: new Date(ends_at) } : {}),
        created_by_user_id: currentUser.id,
      },
    });

    announcementCache.invalidate(ANNOUNCEMENT_CACHE_KEY);

    // DECISION (nie usuwaj tego komentarza):
    // AWAIT (NIE void) audytu zmiany announcement — parytet z resztą admin-config audit
    // (admin-runtime-config / admin-policies / admin-feature-flags / admin-permissions
    // wszystkie awaitują writeRawEventLog_IO). Bare `void` = fire-and-forget BEZ
    // runAfterResponse/waitUntil (jak w admin-bulk), więc na serverless insert mógł zostać
    // ubity po wysłaniu odpowiedzi → zgubiony wiersz audytu zmiany treści admina.
    await writeRawEventLog_IO({
      eventName: APP_EVENTS.INFO.ADMIN.ANNOUNCEMENT_CREATED,
      eventLogType: EventLogTypeValue.ADMIN,
      meta: { created_by_user_id: currentUser.id },
      eventPayloadToStringify: {
        announcement_id: created.id,
        title: created.title,
        type: created.type,
        is_active: created.is_active,
      },
    });

    return success({ id: created.id });
  } catch (error) {
    return databaseFailure('adminCreateAnnouncement_IO', error);
  }
};

/**
 * Update announcement (admin only)
 */
export const adminUpdateAnnouncement_IO = async ({
  id,
  title,
  message,
  type,
  is_active,
  starts_at,
  ends_at,
  currentUser,
}: {
  id: string;
  title?: string;
  message?: string;
  type?: AnnouncementType;
  is_active?: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<OperationResult<undefined, AnnouncementOperationError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  try {
    const existing = await DB_CLIENT.use.announcement.findUnique({
      where: { id },
    });

    if (!existing) {
      return failure({
        type: 'ANNOUNCEMENT_NOT_FOUND',
        announcementId: id,
      });
    }

    // Validate only client-supplied dates; values pulled from `existing` are
    // already-stored (valid) DateTimes. Guards against malformed-string-date -> 500.
    const startsAtError = validateAnnouncementDate(starts_at, 'starts_at');
    if (startsAtError) {
      return failure(startsAtError);
    }
    const endsAtError = validateAnnouncementDate(ends_at, 'ends_at');
    if (endsAtError) {
      return failure(endsAtError);
    }

    const effectiveStartsAt =
      starts_at !== undefined
        ? starts_at
        : (existing.starts_at?.toISOString() ?? null);
    const effectiveEndsAt =
      ends_at !== undefined
        ? ends_at
        : (existing.ends_at?.toISOString() ?? null);

    if (!isValidDateRange(effectiveStartsAt, effectiveEndsAt)) {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'ends_at',
        message: 'ends_at must be after starts_at',
      });
    }

    await DB_CLIENT.use.announcement.update({
      where: { id },
      data: {
        ...(title !== undefined ? { title: title.trim() } : {}),
        ...(message !== undefined ? { message: message.trim() } : {}),
        ...(type !== undefined ? { type } : {}),
        ...(is_active !== undefined ? { is_active } : {}),
        ...(starts_at !== undefined
          ? { starts_at: starts_at ? new Date(starts_at) : null }
          : {}),
        ...(ends_at !== undefined
          ? { ends_at: ends_at ? new Date(ends_at) : null }
          : {}),
      },
    });

    announcementCache.invalidate(ANNOUNCEMENT_CACHE_KEY);

    // AWAIT audytu — parytet z admin-config audit (patrz DECISION przy ANNOUNCEMENT_CREATED).
    await writeRawEventLog_IO({
      eventName: APP_EVENTS.INFO.ADMIN.ANNOUNCEMENT_UPDATED,
      eventLogType: EventLogTypeValue.ADMIN,
      meta: { created_by_user_id: currentUser.id },
      eventPayloadToStringify: {
        announcement_id: id,
        updated_fields: { title, message, type, is_active, starts_at, ends_at },
      },
    });

    return success(undefined);
  } catch (error) {
    // P2025 = "record to update not found": the announcement existed at the
    // findUnique pre-check but a concurrent delete removed it before this update.
    // Surface the idempotent 404 (P2025→NOT_FOUND convention, deletePolicy_IO)
    // instead of a misleading 500.
    if (isP2025(error)) {
      return failure({ type: 'ANNOUNCEMENT_NOT_FOUND', announcementId: id });
    }
    return databaseFailure('adminUpdateAnnouncement_IO', error);
  }
};

/**
 * Delete announcement (admin only)
 */
export const adminDeleteAnnouncement_IO = async ({
  id,
  currentUser,
}: {
  id: string;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<OperationResult<undefined, AnnouncementOperationError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  try {
    const existing = await DB_CLIENT.use.announcement.findUnique({
      where: { id },
    });

    if (!existing) {
      return failure({
        type: 'ANNOUNCEMENT_NOT_FOUND',
        announcementId: id,
      });
    }

    await DB_CLIENT.use.announcement.delete({
      where: { id },
    });

    announcementCache.invalidate(ANNOUNCEMENT_CACHE_KEY);

    // AWAIT audytu — parytet z admin-config audit (patrz DECISION przy ANNOUNCEMENT_CREATED).
    await writeRawEventLog_IO({
      eventName: APP_EVENTS.INFO.ADMIN.ANNOUNCEMENT_DELETED,
      eventLogType: EventLogTypeValue.ADMIN,
      meta: { created_by_user_id: currentUser.id },
      eventPayloadToStringify: {
        announcement_id: id,
        title: existing.title,
      },
    });

    return success(undefined);
  } catch (error) {
    // P2025 = concurrent double-delete race: the announcement existed at the
    // findUnique pre-check but was deleted before this delete ran. Surface the
    // idempotent "already gone" 404 (parity with deletePolicy_IO) instead of a 500.
    if (isP2025(error)) {
      return failure({ type: 'ANNOUNCEMENT_NOT_FOUND', announcementId: id });
    }
    return databaseFailure('adminDeleteAnnouncement_IO', error);
  }
};

/**
 * Get active announcements (public endpoint, authenticated users)
 * Returns only id, title, message, type — no admin metadata
 * Uses 1-minute cache
 */
export const getActiveAnnouncements_IO = async (): Promise<
  OperationResult<ActiveAnnouncementCache, DatabaseError>
> => {
  try {
    const nowMs = Date.now();

    // Cache holds the full is_active set with time boundaries; filter by NOW on
    // every read so an entry that left its window (or just entered it) is reflected
    // immediately, not frozen until the TTL lapses (admin-content-flags-3).
    const cached = announcementCache.get(ANNOUNCEMENT_CACHE_KEY);
    if (cached) {
      return success(
        cached
          .filter(a => isWithinTimeWindow(a, nowMs))
          .map(toPublicAnnouncement)
      );
    }

    // Cache miss — fetch all is_active rows (time-window applied at read time, not
    // baked into the query, so the cached snapshot stays time-evaluable).
    const announcements = await DB_CLIENT.use.announcement.findMany({
      where: { is_active: true },
      orderBy: { created_at: 'desc' },
      take: QUERY_LIMITS.PUBLIC_LIST_DEFAULT,
      select: {
        id: true,
        title: true,
        message: true,
        type: true,
        starts_at: true,
        ends_at: true,
      },
    });

    const cacheEntries: CachedActiveAnnouncement[] = announcements.map(a => ({
      id: a.id,
      title: a.title,
      message: a.message,
      type: assertType(a.type, isAnnouncementTypeNarrower, 'AnnouncementType'),
      starts_at_ms: a.starts_at ? a.starts_at.getTime() : null,
      ends_at_ms: a.ends_at ? a.ends_at.getTime() : null,
    }));

    announcementCache.set(ANNOUNCEMENT_CACHE_KEY, cacheEntries);

    return success(
      cacheEntries
        .filter(a => isWithinTimeWindow(a, nowMs))
        .map(toPublicAnnouncement)
    );
  } catch (error) {
    return databaseFailure('getActiveAnnouncements_IO', error);
  }
};
