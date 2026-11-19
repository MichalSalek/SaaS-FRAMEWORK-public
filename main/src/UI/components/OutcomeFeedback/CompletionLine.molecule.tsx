import { Children, useEffect, useRef, type ReactNode } from 'react';
import { CheckIcon } from '@phosphor-icons/react';
import styles from './OutcomeFeedback.module.css';
import { animateOutcomeChange } from './OutcomeFeedback.motion';
export type CompletionState =
  'idle' | 'dirty' | 'pending' | 'complete' | 'error' | 'blocked';
export interface CompletionLineProps {
  state: CompletionState;
  message: ReactNode;
  reserveMessage?: ReactNode;
  reserveAction?: ReactNode;
  children?: ReactNode;
  className?: string;
  id?: string;
}
export const CompletionLineMolecule = ({
  state,
  message,
  reserveMessage,
  reserveAction,
  children,
  className,
  id,
}: CompletionLineProps) => {
  // Keep the live region mounted, but an empty idle state must not reserve an invisible error box.
  const quiet =
    state === 'idle' &&
    (message == null || message === '') &&
    Children.toArray(children).length === 0;
  const previous = useRef({ state, message });
  const contentRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (
      previous.current.state !== state ||
      (typeof message === 'string' && previous.current.message !== message)
    ) {
      const animation = animateOutcomeChange(contentRef.current);
      previous.current = { state, message };
      return () => animation?.cancel();
    }
    previous.current = { state, message };
    return undefined;
  }, [state, message]);
  return (
    <div
      id={id}
      className={`${styles.line} ${className ?? ''}`}
      data-state={state}>
      {!quiet && (
        <span className={styles.reserve} aria-hidden='true'>
          {reserveAction != null && (
            <span className={styles.actionReserve} inert>
              {reserveAction}
            </span>
          )}
          <span className={styles.lineContent}>
            {reserveMessage ?? message}
          </span>
        </span>
      )}
      <span className={styles.status}>
        {children != null && <span className={styles.retry}>{children}</span>}
        <span
          role={state === 'error' ? 'alert' : 'status'}
          aria-live={state === 'error' ? 'assertive' : 'polite'}
          aria-atomic='true'
          className={styles.liveText}>
          <span ref={contentRef} className={styles.lineContent}>
            {state === 'complete' && (
              <span className={styles.checkSlot} aria-hidden='true'>
                <CheckIcon className={styles.check} />
              </span>
            )}
            <span>{message}</span>
          </span>
        </span>
      </span>
    </div>
  );
};
