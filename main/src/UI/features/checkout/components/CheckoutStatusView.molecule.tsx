// UI/features/checkout/components/CheckoutStatusView.molecule.tsx
// Shared neutral status viewport for the embedded checkout form — the four
// non-form states (loading / init-error / redirect-overdue / recoverable stall)
// all render the same shape: statusViewport + icon + text (+ optional actions).
// Extracted to keep CheckoutForm.molecule under the 300-line cap (single DOM
// contract, behavior-preserving).

import type { ReactNode } from 'react';
import {
  CircleNotchIcon,
  InfoIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import styles from '../PlanCheckoutPanel.module.css';

/** spinner = pending, info = neutral note, warning = init failure. */
type CheckoutStatusVariant = 'spinner' | 'info' | 'warning';

const ICON_SIZE = 32;

export function CheckoutStatusViewMolecule({
  variant,
  role,
  text,
  children,
}: {
  variant: CheckoutStatusVariant;
  role: 'status' | 'alert';
  text: string;
  /** Optional action row (Retry/Cancel) rendered below the text. */
  children?: ReactNode;
}) {
  return (
    <div className={styles.statusViewport} role={role}>
      {variant === 'spinner' && (
        <CircleNotchIcon
          size={ICON_SIZE}
          className={`${styles.statusIcon} ${styles.spinner}`}
          aria-hidden='true'
        />
      )}
      {variant === 'info' && (
        <InfoIcon
          size={ICON_SIZE}
          weight='duotone'
          className={styles.statusIcon}
          aria-hidden='true'
        />
      )}
      {variant === 'warning' && (
        <WarningCircleIcon
          size={ICON_SIZE}
          weight='duotone'
          className={styles.inlineErrorIcon}
          aria-hidden='true'
        />
      )}
      <p className={styles.statusText}>{text}</p>
      {children}
    </div>
  );
}

interface StatusAction {
  label: string;
  onClick: () => void;
}

/**
 * The Retry / Cancel row under a status view (init error, stall, overdue
 * redirect): one markup for the three views that offer a way out. Renders
 * nothing when neither action applies. `retryVariant` keeps the stall's filled
 * retry (resume a payment) apart from the quieter init-error retry.
 */
export function CheckoutStatusActionsMolecule({
  retry,
  retryVariant = 'outlined',
  cancel,
}: {
  retry?: StatusAction | undefined;
  retryVariant?: 'primary' | 'outlined';
  cancel?: StatusAction | undefined;
}) {
  if (retry === undefined && cancel === undefined) {
    return null;
  }
  return (
    <div className={styles.stallActions}>
      {retry !== undefined && (
        <ButtonAtom
          variant={retryVariant}
          size='md'
          {...(retryVariant === 'primary' ? { className: styles.payBtn } : {})}
          onClick={retry.onClick}>
          {retry.label}
        </ButtonAtom>
      )}
      {cancel !== undefined && (
        <ButtonAtom
          variant='text'
          size='md'
          className={styles.cancelBtn}
          onClick={cancel.onClick}>
          {cancel.label}
        </ButtonAtom>
      )}
    </div>
  );
}

export function CheckoutStalledMolecule({
  text,
  retry,
  cancel,
}: {
  text: string;
  retry: StatusAction;
  cancel?: StatusAction | undefined;
}) {
  return (
    <CheckoutStatusViewMolecule variant='info' role='status' text={text}>
      <CheckoutStatusActionsMolecule
        retry={retry}
        retryVariant='primary'
        cancel={cancel}
      />
    </CheckoutStatusViewMolecule>
  );
}

/**
 * A failure BEFORE any payment attempt (the form could not load, or Stripe
 * gave no amount to pay): nothing is committed, so a fresh session and
 * leaving are both safe exits.
 */
export function CheckoutRecoverViewMolecule({
  text,
  retryLabel,
  onRetry,
  cancel,
}: {
  text: string;
  retryLabel: string;
  /** Mints a fresh session; absent when the host offers no retry. */
  onRetry: (() => void) | undefined;
  cancel: StatusAction | undefined;
}) {
  return (
    <CheckoutStatusViewMolecule variant='warning' role='alert' text={text}>
      <CheckoutStatusActionsMolecule
        retry={
          onRetry !== undefined
            ? { label: retryLabel, onClick: onRetry }
            : undefined
        }
        cancel={cancel}
      />
    </CheckoutStatusViewMolecule>
  );
}

export function CheckoutInlineErrorMolecule({
  message,
}: {
  message: string | null;
}) {
  if (message === null) {
    return null;
  }
  return (
    <div className={styles.inlineError} aria-hidden='true'>
      <WarningCircleIcon
        size={18}
        weight='fill'
        className={styles.inlineErrorIcon}
        aria-hidden='true'
      />
      <span>{message}</span>
    </div>
  );
}

/** Keep live regions mounted so assistive technology announces state changes. */
export function CheckoutLiveStatusMolecule({
  progress,
  error,
}: {
  progress: string;
  error: string | null;
}) {
  return (
    <>
      <p className={styles.srStatus} role='status' aria-live='polite'>
        {progress}
      </p>
      <p className={styles.srStatus} role='alert' aria-live='assertive'>
        {error ?? ''}
      </p>
      <CheckoutInlineErrorMolecule message={error} />
    </>
  );
}
