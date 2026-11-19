// Announcement types
import type {
  AnnouncementTranslations,
  AnnouncementAudience,
} from '../../domain/admin/announcement-content';
export type AnnouncementType = 'info' | 'warning' | 'critical';

export type AnnouncementDTO = AnnouncementAudience & {
  translations: AnnouncementTranslations;
  notification_sent_at: string | null;
  id: string;
  title: string;
  message: string;
  type: AnnouncementType;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;

  created_by_user_id: string | null;
  created_at: string;
};
