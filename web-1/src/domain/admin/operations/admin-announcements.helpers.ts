import type {
  AnnouncementDTO,
  AnnouncementType,
} from '@kernel/models/admin/admin.dto';
import type { ValidationError } from '@kernel/application/common-errors.types';
import { createCache } from '@app/cache/cache.utils';
import { CACHE_TTL } from '@kernel/domain/admin/admin.config';
import { parsePgSafeDate } from '@kernel/policies/validation/validation.utils';

/**
 * Helpers for admin-announcements operations: date-field validation,
 * the active-announcements cache, and time-window evaluation.
 * Extracted from admin-announcements.operations.ts to keep that file under the
 * 350-line limit while the operations stay focused on the OperationResult flow.
 */

/**
 * Parseability guard for an announcement date field.
 * The shared-kernel validator only checks `typeof === 'string'`, so a malformed
 * but string date (e.g. 'not-a-real-date', '2026-13-99T99:99:99Z', '   ') would
 * otherwise reach `new Date(value)` -> Invalid Date -> Prisma DateTime throw -> 500.
 * Returns a field-level ValidationError (400) instead, consistent with the
 * reversed-range case in the operations. Empty string / null / undefined are NOT
 * validated here because callers treat them as "no value" (dropped to null on write).
 */
export const validateAnnouncementDate = (
  value: string | null | undefined,
  field: 'starts_at' | 'ends_at'
): ValidationError | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  // Data poza zakresem PostgreSQL to dla nas ta sama klasa co data niepoprawna:
  // ma wrócić 400 z nazwą pola, nie 500 z awarii bazy.
  if (parsePgSafeDate(value) === null) {
    return {
      type: 'VALIDATION_ERROR',
      field,
      message: `${field} must be a valid ISO date string`,
    };
  }
  return null;
};

export const isValidDateRange = (
  starts_at: string | null | undefined,
  ends_at: string | null | undefined
): boolean => {
  if (!starts_at || !ends_at) {
    return true;
  }
  // Reachable only after both values passed validateAnnouncementDate, so both
  // getTime() are finite — no NaN<NaN masking here.
  return new Date(starts_at).getTime() < new Date(ends_at).getTime();
};

// Public shape returned by getActiveAnnouncements_IO — no admin metadata.
export type ActiveAnnouncementCache = Pick<
  AnnouncementDTO,
  'id' | 'title' | 'message' | 'type'
>[];

// DECISION (nie usuwaj tego komentarza):
// The cache stores the full is_active set together with each row's time-window
// boundaries (starts_at/ends_at as epoch ms, null = open) so the snapshot can be
// TIME-EVALUATED per request at read time. Caching the already-windowed result
// (the old behavior) froze the time predicate at fill time, so a banner whose
// ends_at passed (or whose starts_at arrived) within the 60s TTL was served stale
// until a write invalidated the key (admin-content-flags-3). Boundaries never leave
// this module pair — the public projection (toPublicAnnouncement) strips them, so
// the API contract (id/title/message/type only) is unchanged.
export type CachedActiveAnnouncement = {
  id: string;
  title: string;
  message: string;
  type: AnnouncementType;
  starts_at_ms: number | null;
  ends_at_ms: number | null;
};

export const announcementCache = createCache<CachedActiveAnnouncement[]>(
  CACHE_TTL.ANNOUNCEMENTS
);
export const ANNOUNCEMENT_CACHE_KEY = 'active_announcements';

export const isWithinTimeWindow = (
  entry: CachedActiveAnnouncement,
  nowMs: number
): boolean =>
  (entry.starts_at_ms === null || entry.starts_at_ms <= nowMs) &&
  (entry.ends_at_ms === null || entry.ends_at_ms >= nowMs);

export const toPublicAnnouncement = (
  entry: CachedActiveAnnouncement
): ActiveAnnouncementCache[number] => ({
  id: entry.id,
  title: entry.title,
  message: entry.message,
  type: entry.type,
});
