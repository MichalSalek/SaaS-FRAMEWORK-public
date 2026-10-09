// admin/components/AnnouncementCard.molecule.tsx
// One announcement read as a whole: title, what it is now, its type, its
// display window and the full message. Read-only (the preview dialog); the
// list of announcements is a table (AnnouncementsTable).

import { useTranslations } from 'next-intl';
import type { AdminAnnouncement } from '../hooks/useAdminAnnouncements';
import { StatusPillAtom } from '../../../components/StatusPill/StatusPill.atom';
import {
  ANNOUNCEMENT_STATUS_LABEL_KEY,
  ANNOUNCEMENT_TYPE_LABEL_KEY,
  deriveStatus,
  formatAnnouncementWindow,
  getAnnouncementStatusColor,
  getAnnouncementTypeColor,
} from './announcement-status.helpers';
import styles from '../AdminAnnouncementsPage.module.css';

interface AnnouncementCardProps {
  announcement: AdminAnnouncement;
}

export function AnnouncementCardMolecule({
  announcement,
}: AnnouncementCardProps) {
  const t = useTranslations('admin.announcements');
  const status = deriveStatus(announcement);

  return (
    <div className={styles.card}>
      <p className={styles.cardTitle}>{announcement.title}</p>
      <div className={styles.cardMeta}>
        <StatusPillAtom
          color={getAnnouncementStatusColor(status)}
          label={t(ANNOUNCEMENT_STATUS_LABEL_KEY[status])}
        />
        <StatusPillAtom
          color={getAnnouncementTypeColor(announcement.type)}
          label={t(ANNOUNCEMENT_TYPE_LABEL_KEY[announcement.type])}
          showDot={false}
        />
        <span className={styles.window}>
          {formatAnnouncementWindow(announcement, t)}
        </span>
      </div>
      <p className={styles.cardMessage}>{announcement.message}</p>
    </div>
  );
}
