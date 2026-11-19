import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import {
  success,
  type OperationResult,
} from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import {
  announcementVisibleTo,
  readAnnouncementTranslations,
} from '@kernel/domain/admin/announcement-content';
import { QUERY_LIMITS } from '@kernel/domain/admin/admin.config';
import {
  assertType,
  isAnnouncementTypeNarrower,
} from '@kernel/models/type_narrowing';
import {
  ANNOUNCEMENT_CACHE_KEY,
  announcementCache,
  isWithinTimeWindow,
  toPublicAnnouncement,
  type ActiveAnnouncementCache,
  type CachedActiveAnnouncement,
} from './admin-announcements.helpers';

export const getActiveAnnouncements_IO = async (
  params: {
    viewer: 'CLIENT' | 'STYLIST' | null;
    surface: 'public' | 'app';
  } = { viewer: null, surface: 'public' }
): Promise<OperationResult<ActiveAnnouncementCache, DatabaseError>> => {
  try {
    let entries = announcementCache.get(ANNOUNCEMENT_CACHE_KEY);
    if (!entries) {
      const rows = await DB_CLIENT.use.announcement.findMany({
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
          audience_anonymous: true,
          audience_client: true,
          audience_stylist: true,
          translations: true,
        },
      });
      entries = rows.map((row): CachedActiveAnnouncement => ({
        id: row.id,
        title: row.title,
        message: row.message,
        type: assertType(
          row.type,
          isAnnouncementTypeNarrower,
          'AnnouncementType'
        ),
        translations: readAnnouncementTranslations(row.translations, row),
        audience_anonymous: row.audience_anonymous,
        audience_client: row.audience_client,
        audience_stylist: row.audience_stylist,
        starts_at_ms: row.starts_at?.getTime() ?? null,
        ends_at_ms: row.ends_at?.getTime() ?? null,
      }));
      announcementCache.set(ANNOUNCEMENT_CACHE_KEY, entries);
    }
    const now = Date.now();
    return success(
      entries
        .filter(
          entry =>
            isWithinTimeWindow(entry, now) &&
            announcementVisibleTo(entry, params.viewer, params.surface)
        )
        .map(toPublicAnnouncement)
    );
  } catch (error) {
    return databaseFailure('getActiveAnnouncements_IO', error);
  }
};
