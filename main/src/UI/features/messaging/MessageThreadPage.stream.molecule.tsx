// Message stream of a thread: „load older” + bubbles. Extracted so the thread
// composition stays under the 300-line ceiling.

import { useTranslations } from 'next-intl';
import type {
  MessagingMessageDTO,
  MessagingThreadMeta,
} from '@kernel/models/messaging/messaging.dto';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { useMessageWhen } from './hooks/useMessageWhen';
import styles from './MessageThreadPage.module.css';

export function ThreadMessagesMolecule({
  messages,
  viewerSide,
  hasOlder,
  isLoadingOlder,
  onLoadOlder,
}: {
  messages: readonly MessagingMessageDTO[];
  viewerSide: MessagingThreadMeta['viewer_side'] | null;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
}) {
  const t = useTranslations('pages.messaging');
  const when = useMessageWhen();

  return (
    <>
      {hasOlder && (
        <div className={styles.loadOlderRow}>
          {/* The label stays while older messages load: a swapped label
              changed the button's width under the finger. */}
          <ButtonAtom
            variant='outlined'
            size='sm'
            loading={isLoadingOlder}
            onClick={onLoadOlder}>
            {t('loadOlder')}
          </ButtonAtom>
        </div>
      )}
      {messages.map(m => {
        const mine = viewerSide != null && m.sender_type === viewerSide;
        return (
          <div
            key={m.id}
            className={`${styles.row} ${mine ? styles.rowMine : styles.rowOther}`}>
            <div
              className={`${styles.bubble} ${mine ? styles.bubbleMine : styles.bubbleOther}`}>
              <span className={styles.bubbleText}>{m.content}</span>
              <span className={styles.bubbleTime}>
                {when(m.created_at, { withTime: true })}
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
}
