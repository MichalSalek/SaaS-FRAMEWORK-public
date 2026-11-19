import { useState, type RefObject } from 'react';
import {
  BurstOrganism,
  type MessageBurst,
} from './SupportThreadBurst.organism';
import { SupportComposeBarOrganism } from './SupportComposeBar.organism';
import type { TSupport } from './supportDate.helpers';
import styles from './SupportThreadDetailPage.module.css';
export function SupportConversationOrganism({
  bursts,
  t,
  threadId,
  isClosed,
  messagesEndRef,
}: {
  bursts: MessageBurst[];
  t: TSupport;
  threadId: string;
  isClosed: boolean;
  messagesEndRef: RefObject<HTMLDivElement | null>;
}) {
  const [confirmedMessageId, setConfirmedMessageId] = useState<string>();
  return (
    <>
      <div className={styles.messagesList} aria-live='polite'>
        {bursts.map((burst, index) => (
          <BurstOrganism
            key={`burst-${index}-${burst.messages[0]?.id ?? index}`}
            burst={burst}
            t={t}
            confirmedMessageId={confirmedMessageId}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>
      {!isClosed && (
        <SupportComposeBarOrganism
          threadId={threadId}
          onConfirmed={setConfirmedMessageId}
        />
      )}
    </>
  );
}
