// admin/components/AnnouncementSendButton.molecule.tsx
// The bell-and-push action. Disabled states say why; they never send.

import { useTranslations } from 'next-intl';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import type { AnnouncementNotificationSendState } from './announcement-send.logic';
import styles from './AnnouncementCreateEditDialog.module.css';

interface AnnouncementSendButtonProps {
  state: AnnouncementNotificationSendState;
  sentLabel: string | null;
  onSend: () => void;
}

export function AnnouncementSendButtonMolecule({
  state,
  sentLabel,
  onSend,
}: AnnouncementSendButtonProps) {
  const t = useTranslations('admin.announcements');
  let reason: string | null = null;
  if (state === 'already-sent') {
    reason = t('sendUnavailableSent', { date: sentLabel ?? '' });
  } else if (state === 'anonymous-only') {
    reason = t('sendUnavailableAnonymous');
  } else if (state === 'needs-save') {
    reason = t('sendUnavailableUnsaved');
  }
  return (
    <div className={styles.sendBlock}>
      <ButtonAtom
        variant='outlined'
        size='md'
        disabled={state !== 'ready'}
        onClick={onSend}>
        {t('sendNotification')}
      </ButtonAtom>
      {reason !== null && <p className={styles.datesHint}>{reason}</p>}
    </div>
  );
}
