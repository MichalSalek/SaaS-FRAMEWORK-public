// admin/components/announcement-status.helpers.ts
// What an announcement IS right now (derived status), how its status, type and
// display window are named and coloured. One source for the table, the status
// tiles and the preview.

import type { useTranslations } from 'next-intl';
import type { AnnouncementType } from '@kernel/models/admin/admin.dto';
import type { AdminAnnouncement } from '../hooks/useAdminAnnouncements';
import { formatDateShortPL } from '../../../../application/date/date.utils';

export type DerivedAnnouncementStatus =
  'active' | 'scheduled' | 'draft' | 'expired';

/** Display order: what recipients see now, what is coming, what waits, what ended. */
export const ANNOUNCEMENT_STATUSES: readonly DerivedAnnouncementStatus[] = [
  'active',
  'scheduled',
  'draft',
  'expired',
];

export function deriveStatus(
  ann: AdminAnnouncement,
  now: number = Date.now()
): DerivedAnnouncementStatus {
  if (!ann.is_active) {
    return 'draft';
  }
  if (ann.ends_at && new Date(ann.ends_at).getTime() < now) {
    return 'expired';
  }
  // A future starts_at = scheduled, not „active": the backend does not serve it yet, so an „active"
  // pill lied until the start day.
  if (ann.starts_at && new Date(ann.starts_at).getTime() > now) {
    return 'scheduled';
  }
  return 'active';
}

export const ANNOUNCEMENT_STATUS_LABEL_KEY = {
  active: 'statusActive',
  scheduled: 'statusScheduled',
  draft: 'statusDraft',
  expired: 'statusExpired',
} as const satisfies Record<DerivedAnnouncementStatus, string>;

export const ANNOUNCEMENT_TYPE_LABEL_KEY = {
  info: 'typeInfo',
  warning: 'typeWarning',
  critical: 'typeCritical',
} as const satisfies Record<AnnouncementType, string>;

const STATUS_COLOR: Record<DerivedAnnouncementStatus, string> = {
  active: 'var(--color-success)',
  scheduled: 'var(--color-info)',
  draft: 'var(--color-text-secondary)',
  expired: 'var(--color-text-secondary)',
};

const TYPE_COLOR: Record<AnnouncementType, string> = {
  info: 'var(--color-info)',
  warning: 'var(--color-warning)',
  critical: 'var(--color-error)',
};

export function getAnnouncementStatusColor(
  status: DerivedAnnouncementStatus
): string {
  return STATUS_COLOR[status];
}

export function getAnnouncementTypeColor(type: AnnouncementType): string {
  return TYPE_COLOR[type];
}

type WindowTranslator = ReturnType<
  typeof useTranslations<'admin.announcements'>
>;

/** The display window in words. One end alone says which end it is. */
export function formatAnnouncementWindow(
  ann: Pick<AdminAnnouncement, 'starts_at' | 'ends_at'>,
  t: WindowTranslator
): string {
  const start = ann.starts_at ? formatDateShortPL(ann.starts_at, '') : '';
  const end = ann.ends_at ? formatDateShortPL(ann.ends_at, '') : '';
  if (start && end) {
    return t('windowRange', { start, end });
  }
  if (start) {
    return t('windowFrom', { start });
  }
  if (end) {
    return t('windowUntil', { end });
  }
  return t('noSchedule');
}
