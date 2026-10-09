// UI/features/account/AccountRecoveryPage.flows.organism.tsx
// ADRR Model A (§13.1) — the two long states of the recovery screen.
//
// RecoverableView: a soft-deleted account inside its 90-day window. One
//   sentence, then THE action („Przywróć konto”), then what comes back. The
//   number of days left is stated once, in the screen intro (composition).
// ExpiredView: the window has elapsed. What that means, what permanent
//   erasure does, and the one action left (GDPR Art. 17 erase) behind a
//   destructive confirmation.

import {
  ArrowCounterClockwiseIcon,
  CheckIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { AppDialogAtom } from '../../primitives/AppDialog.atom';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import styles from './AccountRecoveryPage.module.css';

/* ============================================================
 *  RECOVERABLE VIEW (soft-deleted, within 90-day window)
 * ============================================================ */

interface RecoverableLabels {
  statusBody: string;
  restoreTitle: string;
  restoreItems: readonly string[];
  recoverBtn: string;
  cancelLink: string;
  dialogTitle: string;
  dialogBody: string;
  dialogCancel: string;
  dialogConfirm: string;
  dialogConfirming: string;
  trustAriaLabel: string;
  trustItems: readonly string[];
}

interface RecoverableViewProps {
  labels: RecoverableLabels;
  isDialogOpen: boolean;
  isRecovering: boolean;
  onOpenDialog: () => void;
  onCancel: () => void;
  onCloseDialog: () => void;
  onConfirmRecover: () => void;
}

export function RecoverableViewOrganism({
  labels,
  isDialogOpen,
  isRecovering,
  onOpenDialog,
  onCancel,
  onCloseDialog,
  onConfirmRecover,
}: RecoverableViewProps) {
  const lang = useCurrentLang();
  return (
    <>
      <p className={styles.lead} lang={lang}>
        {labels.statusBody}
      </p>

      <div className={styles.actions}>
        <ButtonAtom
          variant='primary'
          size='lg'
          icon={<ArrowCounterClockwiseIcon size={18} weight='regular' />}
          onClick={onOpenDialog}
          className='haptic-press'>
          {labels.recoverBtn}
        </ButtonAtom>
        <ButtonAtom variant='ghost' size='lg' onClick={onCancel}>
          {labels.cancelLink}
        </ButtonAtom>
      </div>

      <section className={styles.box}>
        <h2 className={styles.boxTitle}>{labels.restoreTitle}</h2>
        <ul className={styles.checkList}>
          {labels.restoreItems.map(item => (
            <li key={item} className={styles.checkItem}>
              <span className={styles.checkIcon} aria-hidden='true'>
                <CheckIcon size={16} weight='bold' />
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* How the data is kept: three quiet facts, no tinted strip. */}
      <ul className={styles.trustList} aria-label={labels.trustAriaLabel}>
        {labels.trustItems.map(item => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      {/* Reactivate confirmation dialog */}
      <AppDialogAtom
        open={isDialogOpen}
        onOpenChange={open => {
          if (!isRecovering && !open) {
            onCloseDialog();
          }
        }}
        disablePointerDismissal={isRecovering}>
        <AppDialogAtom.Content
          title={labels.dialogTitle}
          closeDisabled={isRecovering}>
          <AppDialogAtom.Body>
            <p className={styles.dialogBodyText}>{labels.dialogBody}</p>
          </AppDialogAtom.Body>
          <AppDialogAtom.Actions>
            <ButtonAtom
              variant='ghost'
              size='lg'
              onClick={onCloseDialog}
              disabled={isRecovering}
              className={styles.dialogBtn}>
              {labels.dialogCancel}
            </ButtonAtom>
            <ButtonAtom
              variant='primary'
              size='lg'
              {...(isRecovering
                ? {}
                : {
                    icon: (
                      <ArrowCounterClockwiseIcon size={18} weight='regular' />
                    ),
                  })}
              onClick={onConfirmRecover}
              disabled={isRecovering}
              aria-busy={isRecovering}
              className={`${styles.dialogBtn} haptic-press`}>
              {isRecovering ? labels.dialogConfirming : labels.dialogConfirm}
            </ButtonAtom>
          </AppDialogAtom.Actions>
        </AppDialogAtom.Content>
      </AppDialogAtom>
    </>
  );
}

/* ============================================================
 *  EXPIRED VIEW (recovery window elapsed → GDPR delete only)
 * ============================================================ */

interface ExpiredLabels {
  statusBody: string;
  gdprTitle: string;
  gdprBody: string;
  gdprBtn: string;
  backLink: string;
  dialogTitle: string;
  dialogBody: string;
  dialogCancel: string;
  dialogConfirm: string;
  dialogConfirming: string;
}

interface ExpiredViewProps {
  labels: ExpiredLabels;
  isDialogOpen: boolean;
  isErasing: boolean;
  onOpenDialog: () => void;
  onBack: () => void;
  onCloseDialog: () => void;
  onConfirmErase: () => void;
}

export function ExpiredViewOrganism({
  labels,
  isDialogOpen,
  isErasing,
  onOpenDialog,
  onBack,
  onCloseDialog,
  onConfirmErase,
}: ExpiredViewProps) {
  const lang = useCurrentLang();
  return (
    <>
      <p className={styles.lead} lang={lang}>
        {labels.statusBody}
      </p>

      <section className={styles.box}>
        <h2 className={styles.boxTitle}>{labels.gdprTitle}</h2>
        <p className={styles.boxText} lang={lang}>
          {labels.gdprBody}
        </p>
      </section>

      <div className={styles.actions}>
        <ButtonAtom
          variant='danger'
          size='lg'
          icon={<TrashIcon size={18} weight='regular' />}
          onClick={onOpenDialog}
          className='haptic-press'>
          {labels.gdprBtn}
        </ButtonAtom>
        <ButtonAtom variant='ghost' size='lg' onClick={onBack}>
          {labels.backLink}
        </ButtonAtom>
      </div>

      {/* GDPR permanent-erasure confirmation dialog (destructive) */}
      <AppDialogAtom
        open={isDialogOpen}
        onOpenChange={open => {
          if (!isErasing && !open) {
            onCloseDialog();
          }
        }}
        disablePointerDismissal={isErasing}>
        <AppDialogAtom.Content
          title={labels.dialogTitle}
          closeDisabled={isErasing}>
          <AppDialogAtom.Body>
            <p className={styles.dialogBodyText}>{labels.dialogBody}</p>
          </AppDialogAtom.Body>
          <AppDialogAtom.Actions>
            <ButtonAtom
              variant='ghost'
              size='lg'
              onClick={onCloseDialog}
              disabled={isErasing}
              className={styles.dialogBtn}>
              {labels.dialogCancel}
            </ButtonAtom>
            <ButtonAtom
              variant='danger'
              size='lg'
              {...(isErasing
                ? {}
                : { icon: <TrashIcon size={18} weight='fill' /> })}
              onClick={onConfirmErase}
              disabled={isErasing}
              aria-busy={isErasing}
              className={`${styles.dialogBtn} haptic-press`}>
              {isErasing ? labels.dialogConfirming : labels.dialogConfirm}
            </ButtonAtom>
          </AppDialogAtom.Actions>
        </AppDialogAtom.Content>
      </AppDialogAtom>
    </>
  );
}
