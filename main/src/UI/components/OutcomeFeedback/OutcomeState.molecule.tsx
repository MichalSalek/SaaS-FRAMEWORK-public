import { useEffect, useRef, type ReactNode } from 'react';
import { CheckIcon } from '@phosphor-icons/react';
import styles from './OutcomeFeedback.module.css';
import { animateOutcomeChange } from './OutcomeFeedback.motion';
export interface OutcomeStateProps {
  message?: ReactNode;
  children?: ReactNode;
  confirmed: boolean;
  completionKey?: string | number;
  className?: string;
  marked?: boolean;
  /** Explicit local action receipt, never a polling/read confirmation. */
  animateOnConfirm?: boolean;
}
export const OutcomeStateMolecule = ({
  message,
  children,
  confirmed,
  completionKey,
  className,
  marked = true,
  animateOnConfirm = false,
}: OutcomeStateProps) => {
  const previous = useRef(completionKey);
  const resultRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (
      completionKey !== undefined &&
      previous.current !== completionKey &&
      confirmed
    ) {
      const animation = animateOutcomeChange(resultRef.current);
      previous.current = completionKey;
      return () => animation?.cancel();
    }
    previous.current = completionKey;
    return undefined;
  }, [completionKey, confirmed]);
  const showsResult = confirmed && (message != null || marked);
  // DECISION: with nothing to show and no children the molecule renders NOTHING, not an empty
  // <div>. Screens place it as a flex/grid child, and an empty box still takes the container's gap
  // on both sides (a 48px hole above the client's scan card on /app/pairing, three stacked on the
  // salon team page). The status span is created on confirm either way, so no live region is lost.
  if (children == null && !showsResult) {
    return null;
  }
  return (
    <div
      className={`${styles.outcome} ${animateOnConfirm && confirmed && completionKey !== undefined ? styles.changed : ''} ${className ?? ''}`}
      data-confirmed={confirmed}>
      {children}
      {showsResult && (
        <span
          ref={resultRef}
          role={message != null ? 'status' : undefined}
          className={styles.result}>
          {marked && (
            <span className={styles.checkSlot} aria-hidden='true'>
              <CheckIcon className={styles.check} />
            </span>
          )}
          {message != null && <span>{message}</span>}
        </span>
      )}
    </div>
  );
};
