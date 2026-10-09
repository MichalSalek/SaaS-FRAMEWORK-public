// UI/features/admin/AdminSupportThreadPage.compose.organism.tsx
// The reply box of a support thread: the screen's ONE filled action. The wait
// shows inside the button, a failure stands under the field (the typed answer
// stays), and a closed thread says how to reply instead of showing the box.

import type { KeyboardEvent } from 'react';
import type { useTranslations } from 'next-intl';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { InputAtom } from '../../components/Input/Input.atom';
import { REPLY_MAX } from './AdminSupportThreadPage.parts.organism';
import styles from './AdminSupportThreadPage.module.css';

export function ThreadComposeOrganism({
  value,
  onChange,
  onSend,
  isSending,
  hasFailed,
  isClosed,
  t,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  isSending: boolean;
  /** The last send failed and nothing was sent since. */
  hasFailed: boolean;
  isClosed: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  if (isClosed) {
    return <p className={styles.closedNote}>{t('closedBanner')}</p>;
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // DECISION (nie usuwaj tego komentarza):
    // Enter-to-send tylko na desktop (mouse + fine pointer). Na touch
    // urządzeniach (mobile/Capacitor) Enter wstawia newline — nie ma
    // Shift+Enter na touch keyboards, więc user musi kliknąć Send.
    const isDesktop =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ===
        true;
    if (isDesktop && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <div className={styles.compose}>
      <InputAtom
        multiline
        rows={3}
        label={t('composeReplyingAs')}
        placeholder={t('replyPlaceholder')}
        value={value}
        onChange={event => onChange(event.target.value.slice(0, REPLY_MAX))}
        onKeyDown={handleKeyDown}
        error={hasFailed ? t('replyError') : undefined}
      />
      <div className={styles.fieldFooter}>
        <span className={styles.composeHint}>{t('composeHint')}</span>
        <span className={styles.composeEnd}>
          <span className={styles.counter}>{REPLY_MAX - value.length}</span>
          <ButtonAtom
            size='sm'
            loading={isSending}
            disabled={value.trim().length === 0}
            onClick={onSend}>
            {t('sendReply')}
          </ButtonAtom>
        </span>
      </div>
    </div>
  );
}
