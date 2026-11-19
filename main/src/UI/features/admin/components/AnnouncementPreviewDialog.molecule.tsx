// admin/components/AnnouncementPreviewDialog.molecule.tsx
// Read-only preview of one announcement.

import { useTranslations } from 'next-intl';
import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import { AppDialogAtom } from '../../../primitives/AppDialog.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import type { AdminAnnouncement } from '../hooks/useAdminAnnouncements';
import { AnnouncementCardMolecule } from './AnnouncementCard.molecule';

interface AnnouncementPreviewDialogProps {
  open: boolean;
  announcement: AdminAnnouncement | null;
  onClose: () => void;
  onEdit: (announcement: AdminAnnouncement) => void;
  onSend: (announcement: AdminAnnouncement) => void;
  onTest: (announcement: AdminAnnouncement, locale: LocaleType) => void;
}

export function AnnouncementPreviewDialogMolecule({
  open,
  announcement,
  onClose,
  onEdit,
  onSend,
  onTest,
}: AnnouncementPreviewDialogProps) {
  const t = useTranslations('admin.announcements');
  return (
    <AppDialogAtom
      open={open}
      onOpenChange={next => {
        if (!next) {
          onClose();
        }
      }}>
      <AppDialogAtom.Content
        title={t('previewTitle')}
        description={t('previewDescription')}>
        <AppDialogAtom.Body>
          {announcement && (
            <AnnouncementCardMolecule
              announcement={announcement}
              onSend={onSend}
              onTest={onTest}
            />
          )}
        </AppDialogAtom.Body>
        <AppDialogAtom.Actions>
          <ButtonAtom variant='outlined' size='md' onClick={onClose}>
            {t('close')}
          </ButtonAtom>
          {announcement && (
            <ButtonAtom
              variant='outlined'
              size='md'
              onClick={() => onEdit(announcement)}>
              {t('menuEdit')}
            </ButtonAtom>
          )}
        </AppDialogAtom.Actions>
      </AppDialogAtom.Content>
    </AppDialogAtom>
  );
}
