import { LockSimpleIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import styles from '../PlanCheckoutPanel.module.css';
import { useTranslations } from 'next-intl';
import { CheckoutLiveStatusMolecule } from './CheckoutStatusView.molecule';

export function CheckoutActionsMolecule({
  confirming,
  disabled,
  shake,
  onShakeEnd,
  onPay,
  onCancel,
  cancelDisabled,
  payLabel,
  cancelLabel,
  secureHint,
  processingLabel,
  needsCompanyUpdate,
  progress,
  error,
}: {
  confirming: boolean;
  disabled: boolean;
  shake: boolean;
  onShakeEnd: () => void;
  onPay: () => void;
  onCancel: (() => void) | undefined;
  cancelDisabled: boolean;
  payLabel: string;
  cancelLabel: string;
  secureHint: string;
  processingLabel: string;
  needsCompanyUpdate: boolean;
  progress: string;
  error: string | null;
}) {
  const t = useTranslations('account.checkout');
  return (
    <>
      <CheckoutLiveStatusMolecule progress={progress} error={error} />
      <div className={styles.actions}>
        <ButtonAtom
          variant='primary'
          size='lg'
          className={styles.payBtn}
          onClick={onPay}
          disabled={disabled}
          aria-busy={confirming}
          shake={shake}
          onShakeEnd={onShakeEnd}
          loading={confirming}>
          {confirming
            ? processingLabel
            : needsCompanyUpdate
              ? t('updateBillingDetails')
              : payLabel}
        </ButtonAtom>
        {onCancel !== undefined && (
          <ButtonAtom
            variant='text'
            size='md'
            className={styles.cancelBtn}
            onClick={onCancel}
            disabled={cancelDisabled}>
            {cancelLabel}
          </ButtonAtom>
        )}
        <p className={styles.secureHint}>
          <LockSimpleIcon
            size={13}
            weight='fill'
            className={styles.secureHintIcon}
            aria-hidden='true'
          />
          {secureHint}
        </p>
      </div>
    </>
  );
}
