import { trackFlowStep } from '../../../application/analytics/flow-events';
import { OutcomeStateMolecule } from '../../components/OutcomeFeedback/OutcomeState.molecule';
// Message stream of a thread: „load older” + bubbles. Extracted so the thread
// composition stays under the 300-line ceiling.

import { useTranslations } from 'next-intl';
import { AppLinkAtom } from '../../components/AppLink/AppLink.atom';
import Image from 'next/image';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../application/routing/buildRoute';
import type {
  MessagingMessageDTO,
  MessagingThreadMeta,
} from '@kernel/models/messaging/messaging.dto';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { useMessageWhen } from './hooks/useMessageWhen';
import styles from './MessageThreadPage.module.css';

export function ThreadMessagesMolecule({
  messages,
  confirmedMessageId,
  viewerSide,
  hasOlder,
  isLoadingOlder,
  onLoadOlder,
}: {
  messages: readonly MessagingMessageDTO[];
  confirmedMessageId?: string | undefined;
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
        const isCard =
          m.kind != null && m.kind !== 'TEXT' && m.session_id != null;
        const title =
          m.kind === 'SESSION_SUBMITTED'
            ? t('sessionSubmitted')
            : m.kind === 'SESSION_ACCEPTED'
              ? t('sessionAccepted')
              : m.kind === 'SESSION_CHANGED'
                ? t('sessionChanged')
                : m.content;
        const scope =
          m.change_scope === 'PHOTOS'
            ? t('sessionChangedPhotos')
            : m.change_scope === 'NOTE'
              ? t('sessionChangedNote')
              : m.change_scope === 'PHOTOS_AND_NOTE'
                ? t('sessionChangedPhotosAndNote')
                : null;
        const sessionRoute =
          viewerSide === 'STYLIST'
            ? ROUTES_FRONT.SESSION_DETAIL
            : ROUTES_FRONT.CLIENT_SESSION_DETAIL;
        return (
          <div
            key={m.id}
            className={`${styles.row} ${mine ? styles.rowMine : styles.rowOther}`}>
            <OutcomeStateMolecule
              confirmed={m.id === confirmedMessageId}
              {...(m.id === confirmedMessageId ? { completionKey: m.id } : {})}
              animateOnConfirm
              marked={false}
              className={`${styles.bubble} ${mine ? styles.bubbleMine : styles.bubbleOther}`}>
              {isCard && m.session_id ? (
                <AppLinkAtom
                  className={styles.sessionCard}
                  onClick={() =>
                    trackFlowStep('session', 'activity_opened', {
                      kind: m.kind,
                      measurement_version: 1,
                    })
                  }
                  href={buildRoute(sessionRoute, { sessionId: m.session_id })}>
                  <span>
                    {title}
                    {scope ? `: ${scope}` : ''}
                  </span>
                  {m.kind === 'SESSION_SUBMITTED' &&
                    m.session_preview &&
                    m.session_preview.thumbnails.length > 0 && (
                      <span className={styles.sessionThumbnails}>
                        {m.session_preview.thumbnails.map((src, index) => (
                          <Image
                            key={`${src}-${index}`}
                            src={src}
                            alt=''
                            width={48}
                            height={48}
                            unoptimized
                            loading='lazy'
                          />
                        ))}
                        {m.session_preview.remaining_count > 0 && (
                          <span>+{m.session_preview.remaining_count}</span>
                        )}
                      </span>
                    )}
                </AppLinkAtom>
              ) : (
                <span className={styles.bubbleText}>{m.content}</span>
              )}
              <span className={styles.bubbleTime}>
                {when(m.created_at, { withTime: true })}
              </span>
            </OutcomeStateMolecule>
          </div>
        );
      })}
    </>
  );
}
