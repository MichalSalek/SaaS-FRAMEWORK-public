import { OutcomeStateMolecule } from '../../components/OutcomeFeedback/OutcomeState.molecule';
// UI/features/support/SupportThreadBurst.tsx
// Burst = a group of consecutive same-sender messages (Linear / Intercom UX).
// Renders one avatar+name header per burst + an attached stack of bubbles.

import { LifebuoyIcon } from '@phosphor-icons/react';
import type { SupportMessageDTO } from '@kernel/models/support/support.dto';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import {
  formatRelativeDate,
  formatMessageTime,
  type TSupport,
} from './supportDate.helpers';
import styles from './SupportThreadDetailPage.module.css';

/* ------------------------------------------------------------------ */
/*  Burst grouping                                                      */
/* ------------------------------------------------------------------ */

export type MessageBurst = {
  sender_type: SupportMessageDTO['sender_type'];
  messages: SupportMessageDTO[];
};

export function groupIntoBursts(messages: SupportMessageDTO[]): MessageBurst[] {
  const bursts: MessageBurst[] = [];
  for (const msg of messages) {
    const last = bursts[bursts.length - 1];
    if (last !== undefined && last.sender_type === msg.sender_type) {
      last.messages.push(msg);
    } else {
      bursts.push({ sender_type: msg.sender_type, messages: [msg] });
    }
  }
  return bursts;
}

/* ------------------------------------------------------------------ */
/*  Burst header — avatar + identity + time                             */
/* ------------------------------------------------------------------ */

function BurstHeader({
  senderType,
  firstMessageAt,
  t,
}: {
  senderType: SupportMessageDTO['sender_type'];
  firstMessageAt: string | Date;
  t: TSupport;
}) {
  const lang = useCurrentLang();
  const isUser = senderType === 'USER';

  // User side keeps ONLY the time meta: the "TY" label
  // and an empty avatar were noise (right-aligning the bubble is enough
  // as an authorship signal).
  if (isUser) {
    return (
      <div className={`${styles.burstHeader} ${styles.burstHeaderUser}`}>
        <TypographyAtom variant='caption' className={styles.burstTime}>
          {formatRelativeDate(firstMessageAt, t, lang)}
        </TypographyAtom>
      </div>
    );
  }

  // One team label ("Zespół Nailfolio"): the role line
  // "Pomoc Nailfolio" said the same thing twice.
  return (
    <div className={`${styles.burstHeader} ${styles.burstHeaderSupport}`}>
      <div
        className={`${styles.burstAvatar} ${styles.burstAvatarSupport}`}
        aria-hidden='true'>
        <LifebuoyIcon size={20} weight='fill' />
      </div>
      <div className={styles.burstIdentity}>
        <TypographyAtom variant='caption' className={styles.burstName}>
          {t('teamName')}
        </TypographyAtom>
      </div>
      <TypographyAtom variant='caption' className={styles.burstTime}>
        {formatRelativeDate(firstMessageAt, t, lang)}
      </TypographyAtom>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Single message bubble                                                */
/* ------------------------------------------------------------------ */

function MessageBubble({
  message,
  isLastInBurst,
  confirmedMessageId,
}: {
  message: SupportMessageDTO;
  isLastInBurst: boolean;
  confirmedMessageId?: string | undefined;
}) {
  const lang = useCurrentLang();
  const isUser = message.sender_type === 'USER';

  return (
    <OutcomeStateMolecule
      confirmed={message.id === confirmedMessageId}
      {...(message.id === confirmedMessageId
        ? { completionKey: message.id }
        : {})}
      animateOnConfirm
      marked={false}
      className={`${styles.messageBubble} ${isUser ? styles.messageBubbleUser : styles.messageBubbleSupport} ${isLastInBurst ? styles.messageBubbleLast : ''}`}>
      <p className={styles.messageContent}>{message.content}</p>
      <span className={styles.messageTime} aria-hidden='true'>
        {formatMessageTime(message.created_at, lang)}
      </span>
    </OutcomeStateMolecule>
  );
}

/* ------------------------------------------------------------------ */
/*  Burst — header + bubble stack                                       */
/* ------------------------------------------------------------------ */

export function BurstOrganism({
  burst,
  t,
  confirmedMessageId,
}: {
  burst: MessageBurst;
  confirmedMessageId?: string | undefined;
  t: TSupport;
}) {
  const isUser = burst.sender_type === 'USER';
  const firstMessage = burst.messages[0];
  const firstAt =
    firstMessage !== undefined ? firstMessage.created_at : new Date();

  return (
    <div
      className={`${styles.burst} ${isUser ? styles.burstUser : styles.burstSupport}`}>
      <BurstHeader
        senderType={burst.sender_type}
        firstMessageAt={firstAt}
        t={t}
      />
      <div className={styles.burstStack}>
        {burst.messages.map((msg, idx) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            confirmedMessageId={confirmedMessageId}
            isLastInBurst={idx === burst.messages.length - 1}
          />
        ))}
      </div>
    </div>
  );
}
