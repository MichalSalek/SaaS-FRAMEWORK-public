import { useTranslations } from 'next-intl';
import type { AdminAnnouncement } from '../hooks/useAdminAnnouncements';
import { AdminConfirmDeleteDialogMolecule } from './AdminConfirmDeleteDialog.molecule';

export function AnnouncementDeleteConfirmDialogMolecule({
  announcement,
  isDeleting,
  onConfirm,
  onCancel,
}: {
  announcement: AdminAnnouncement | null;
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('admin.announcements');
  return (
    <AdminConfirmDeleteDialogMolecule
      open={announcement !== null}
      title={t('deleteTitle')}
      message={t(
        announcement?.notification_sent_at != null
          ? 'deleteSentMessage'
          : 'deleteMessage',
        { title: announcement?.title ?? '' }
      )}
      confirmLabel={t('deleteConfirm')}
      cancelLabel={t('cancel')}
      isDeleting={isDeleting}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
