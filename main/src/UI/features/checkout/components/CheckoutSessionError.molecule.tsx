import { WarningCircleIcon } from '@phosphor-icons/react';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { isIOError } from '../../../../application/http/io';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import styles from '../PlanCheckoutPanel.module.css';

export function isCheckoutTermsChanged(error: unknown): boolean {
  if (
    !isIOError(error) ||
    error.httpError.event !== APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED
  ) {
    return false;
  }
  const data = error.httpError.data;
  return (
    typeof data === 'object' &&
    data !== null &&
    'code' in data &&
    data.code === 'CHECKOUT_TERMS_CHANGED'
  );
}
export function CheckoutSessionErrorMolecule({
  message,
  action,
  onAction,
}: {
  message: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className={styles.statusViewport} role='alert'>
      <WarningCircleIcon
        size={32}
        weight='duotone'
        className={styles.inlineErrorIcon}
        aria-hidden='true'
      />
      <p className={styles.statusText}>{message}</p>
      <ButtonAtom variant='outlined' onClick={onAction}>
        {action}
      </ButtonAtom>
    </div>
  );
}
