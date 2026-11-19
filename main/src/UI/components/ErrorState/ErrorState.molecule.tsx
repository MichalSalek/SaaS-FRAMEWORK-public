// UI/components/ErrorState/ErrorState.molecule.tsx
// Canonical inline error state for any view whose data query fails — icon +
// message + optional retry button, rendered in the page body (never a silent
// or empty "no data" state). Promoted from the admin-only AdminErrorState so
// every feature (messaging, salon-staff, client-card, admin) shares ONE error
// surface instead of divergent inline/no-retry/none patterns.
//
// Pattern: flat editorial — solid surface-card + hairline border (anti-slop
// floor: NO box-shadow, NO gradient). For higher-polish, user-facing landing
// surfaces prefer the branded editorial error card of that feature instead.

import { XCircleIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../Button/Button.atom';
import styles from './ErrorState.molecule.module.css';

export interface ErrorStateProps {
  /** Translated, human-readable failure message. */
  message: string;
  /** Translated retry label. Required together with `onRetry` to show the button. */
  retryLabel?: string;
  /** Retry handler (typically the query's `refetch`). Omit to render message-only. */
  onRetry?: () => void;
  /** A retry is in flight (typically the query's `isFetching`): the button
   *  turns busy and inert, so a tap visibly did something and cannot stack
   *  a second request. */
  isRetrying?: boolean;
  /**
   * `card` (default) — the error stands INSTEAD of a card: it brings its own
   * box and generous padding. `inline` — the error sits INSIDE a card, a
   * dialog or a sheet that already is the box: no background, no frame, tight
   * padding (a box inside a box is banned by the house style).
   */
  size?: 'card' | 'inline';
}

export function ErrorStateMolecule({
  message,
  retryLabel,
  onRetry,
  isRetrying = false,
  size = 'card',
}: ErrorStateProps) {
  return (
    <div className={styles.errorState} data-size={size} role='alert'>
      <XCircleIcon
        size={size === 'inline' ? 28 : 36}
        weight='fill'
        aria-hidden='true'
      />
      <span className={styles.errorText}>{message}</span>
      {onRetry !== undefined && retryLabel !== undefined ? (
        <ButtonAtom
          size='sm'
          variant='outlined'
          onClick={onRetry}
          loading={isRetrying}>
          {retryLabel}
        </ButtonAtom>
      ) : null}
    </div>
  );
}
