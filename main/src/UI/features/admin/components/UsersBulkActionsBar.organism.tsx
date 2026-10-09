// admin/components/UsersBulkActionsBar.tsx
// Bulk action bar — Enable, Disable, Change Plan, Logout.
// Disabled when nothing is selected (visible but inert).

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  CheckCircleIcon,
  ProhibitIcon,
  TagIcon,
  SignOutIcon,
  XIcon,
  WarningIcon,
} from '@phosphor-icons/react';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import styles from '../AdminUsersPage.module.css';

// Destructive bulk ops (disable sessions, force logout) get a confirm step once the
// selection is non-trivial — a misclick on "select all" then Disable can hit many
// accounts at once. Enable + change-plan are benign and fire without confirmation.
type PendingBulk = 'disable' | 'logout' | null;
const BULK_CONFIRM_THRESHOLD = 5;

export interface UsersBulkActionsBarProps {
  selectedCount: number;
  onClear: () => void;
  onEnable: () => void;
  onDisable: () => void;
  onChangePlan: (plan: PricingPlan) => void;
  onLogout: () => void;
  isEnabling: boolean;
  isDisabling: boolean;
  isChangingPlan: boolean;
  isLoggingOut: boolean;
}

const PLAN_VALUES = Object.values(PricingPlanValue);

export function UsersBulkActionsBarOrganism({
  selectedCount,
  onClear,
  onEnable,
  onDisable,
  onChangePlan,
  onLogout,
  isEnabling,
  isDisabling,
  isChangingPlan,
  isLoggingOut,
}: UsersBulkActionsBarProps) {
  const t = useTranslations('admin.users');
  const [planChooserOpen, setPlanChooserOpen] = useState(false);
  const [pendingBulk, setPendingBulk] = useState<PendingBulk>(null);
  const disabled = selectedCount === 0;

  // Inline confirm = alertdialog: needs an accessible name (the message) and
  // must RECEIVE focus when it appears — the trigger button unmounts with the
  // bar, so without this the focus fell to <body> and SR users heard nothing.
  const confirmTextId = useId();
  const confirmCancelWrapRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (pendingBulk !== null) {
      confirmCancelWrapRef.current?.querySelector('button')?.focus();
    }
  }, [pendingBulk]);

  const handleChooseAndApplyPlan = (plan: PricingPlan) => {
    setPlanChooserOpen(false);
    onChangePlan(plan);
  };

  // Confirm only above the threshold; small selections fire immediately to keep
  // the common case fast.
  const requestDisable = () => {
    if (selectedCount >= BULK_CONFIRM_THRESHOLD) {
      setPendingBulk('disable');
    } else {
      onDisable();
    }
  };

  const requestLogout = () => {
    if (selectedCount >= BULK_CONFIRM_THRESHOLD) {
      setPendingBulk('logout');
    } else {
      onLogout();
    }
  };

  if (pendingBulk !== null) {
    const isDisable = pendingBulk === 'disable';
    const inProgress = isDisable ? isDisabling : isLoggingOut;
    return (
      <div
        className={styles.bulkBar}
        role='alertdialog'
        aria-labelledby={confirmTextId}>
        <WarningIcon
          size={20}
          className={styles.bulkConfirmIcon}
          aria-hidden='true'
        />
        <span id={confirmTextId} className={styles.bulkConfirmText}>
          {isDisable
            ? t('bulkConfirmDisable', { count: selectedCount })
            : t('bulkConfirmLogout', { count: selectedCount })}
        </span>
        <span ref={confirmCancelWrapRef}>
          <ButtonAtom
            size='sm'
            variant='ghost'
            onClick={() => setPendingBulk(null)}
            disabled={inProgress}>
            {t('bulkConfirmCancel')}
          </ButtonAtom>
        </span>
        <ButtonAtom
          size='sm'
          variant='primary'
          onClick={() => {
            if (isDisable) {
              onDisable();
            } else {
              onLogout();
            }
            setPendingBulk(null);
          }}
          disabled={inProgress}>
          {isDisable ? t('bulkConfirmDisableCta') : t('bulkConfirmLogoutCta')}
        </ButtonAtom>
      </div>
    );
  }

  return (
    <div
      className={`${styles.bulkBar} ${disabled ? styles.bulkBarDisabled : ''}`}>
      <span className={styles.bulkCount}>
        {selectedCount > 0
          ? t('bulkSelected', { count: selectedCount })
          : t('bulkSelectUsers')}
      </span>
      <ButtonAtom
        size='sm'
        variant='ghost'
        icon={<XIcon size={14} />}
        onClick={onClear}
        disabled={disabled}>
        {t('bulkClear')}
      </ButtonAtom>
      <ButtonAtom
        size='sm'
        variant='outlined'
        icon={<CheckCircleIcon size={14} />}
        onClick={onEnable}
        disabled={disabled || isEnabling}>
        {isEnabling ? t('bulkEnabling') : t('bulkEnable')}
      </ButtonAtom>
      <ButtonAtom
        size='sm'
        variant='outlined'
        icon={<ProhibitIcon size={14} />}
        onClick={requestDisable}
        disabled={disabled || isDisabling}>
        {isDisabling ? t('bulkDisabling') : t('bulkDisable')}
      </ButtonAtom>
      <ButtonAtom
        size='sm'
        variant='outlined'
        icon={<TagIcon size={14} />}
        onClick={() => setPlanChooserOpen(o => !o)}
        disabled={disabled || isChangingPlan}>
        {isChangingPlan ? t('bulkChangingPlan') : t('bulkChangePlan')}
      </ButtonAtom>
      <ButtonAtom
        size='sm'
        variant='outlined'
        icon={<SignOutIcon size={14} />}
        onClick={requestLogout}
        disabled={disabled || isLoggingOut}>
        {isLoggingOut ? t('bulkLoggingOut') : t('bulkLogout')}
      </ButtonAtom>

      {planChooserOpen && !disabled && (
        <>
          <span className={styles.bulkSpacer} />
          {/* Plany to równorzędne alternatywy, nie jeden czasownik. */}
          {PLAN_VALUES.map(plan => (
            <ButtonAtom
              key={plan}
              size='sm'
              variant='outlined'
              onClick={() => handleChooseAndApplyPlan(plan)}>
              {plan}
            </ButtonAtom>
          ))}
        </>
      )}
    </div>
  );
}
