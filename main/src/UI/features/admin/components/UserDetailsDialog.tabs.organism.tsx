// admin/components/UserDetailsDialog.tabs.organism.tsx
// ActionsTab of the user sheet (plan change, disable or enable, delete).
// ProfileTab lives in UserDetailsDialog.profileTab.molecule.tsx.

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import {
  TrashIcon,
  ProhibitIcon,
  CheckCircleIcon,
  CreditCardIcon,
} from '@phosphor-icons/react';
import { AppSelectAtom } from '../../../primitives/AppSelect.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import type { AdminUserRecord } from '../hooks/useAdminUsers';
import {
  getPlanDisplayName,
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { useDeleteAnyUser } from '../hooks/useDeleteAnyUser';
import { useDisableUser } from '../hooks/useDisableUser';
import { useEnableUser } from '../hooks/useEnableUser';
import { useChangePricingPlan } from '../hooks/useChangePricingPlan';
import { AdminConfirmDeleteDialogMolecule } from './AdminConfirmDeleteDialog.molecule';
import styles from './UserDetailsDialog.module.css';

export { ProfileTabMolecule } from './UserDetailsDialog.profileTab.molecule';

const PRICING_PLAN_OPTIONS: ReadonlyArray<{
  label: string;
  value: PricingPlan;
}> = Object.values(PricingPlanValue).map(plan => ({
  label: getPlanDisplayName(plan),
  value: plan,
}));

/* ─── Actions tab ─── */

type PendingConfirm = 'delete' | 'disable' | null;

// Self/other-admin lock lives in the PARENT (the tab is not rendered at all
// for those users) — a second `isLocked` branch here was unreachable.
interface ActionsTabProps {
  user: AdminUserRecord;
  onActionComplete: () => void;
}

export function ActionsTabOrganism({
  user,
  onActionComplete,
}: ActionsTabProps) {
  const t = useTranslations('admin.users');
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null);
  const [selectedPlan, setSelectedPlan] = useState<PricingPlan>(
    user.stylist_account?.pricing_plan ?? PricingPlanValue.FREE
  );

  const deleteMut = useDeleteAnyUser();
  const disableMut = useDisableUser();
  const enableMut = useEnableUser();
  const changePlanMut = useChangePricingPlan();

  // Reset pending confirm + plan selection if a different user is opened
  useEffect(() => {
    setPendingConfirm(null);
    setSelectedPlan(
      user.stylist_account?.pricing_plan ?? PricingPlanValue.FREE
    );
  }, [user.id, user.stylist_account?.pricing_plan]);

  const handleDelete = () => {
    deleteMut.mutate(
      { id: user.id },
      {
        onSuccess: () => {
          pushNewSnackbar(t('actionDeleteSuccess'), 'success');
          setPendingConfirm(null);
          onActionComplete();
        },
        onError: () => pushNewSnackbar(t('actionDeleteError'), 'error'),
      }
    );
  };

  // DECISION (nie usuwaj tego komentarza):
  // Wszystkie akcje moderacyjne (delete/disable/enable/change-plan) wołają
  // onActionComplete() po sukcesie, żeby ZAMKNĄĆ dialog i wrócić do świeżo
  // zinwalidowanej tabeli. `user` to ZAMROŻONY snapshot przekazany z
  // AdminUsersPage (detailUser state) — mutacje inwalidują queryKeys.admin.usersAll
  // (tabela się odświeża), ale ten obiekt NIE, więc taby Actions/Profile
  // pokazywałyby stan sprzed mutacji (stale snapshot). Zamknięcie po sukcesie =
  // spójne z delete (który i tak musi zamknąć, bo rekord znika) i gwarantuje,
  // że admin widzi aktualny stan w odświeżonej tabeli, a nie zamrożony w dialogu.
  const handleDisable = () => {
    disableMut.mutate(
      { id: user.id },
      {
        onSuccess: () => {
          pushNewSnackbar(t('actionDisableSuccess'), 'success');
          setPendingConfirm(null);
          onActionComplete();
        },
        onError: () => pushNewSnackbar(t('actionDisableError'), 'error'),
      }
    );
  };

  const handleEnable = () => {
    enableMut.mutate(
      { id: user.id },
      {
        onSuccess: () => {
          pushNewSnackbar(t('actionEnableSuccess'), 'success');
          onActionComplete();
        },
        onError: () => pushNewSnackbar(t('actionEnableError'), 'error'),
      }
    );
  };

  const handleChangePlan = () => {
    changePlanMut.mutate(
      { id: user.id, pricing_plan: selectedPlan },
      {
        onSuccess: () => {
          pushNewSnackbar(t('actionChangePlanSuccess'), 'success');
          onActionComplete();
        },
        onError: () => pushNewSnackbar(t('actionChangePlanError'), 'error'),
      }
    );
  };

  // DECISION (nie usuwaj tego komentarza):
  // user.is_active=true → user is active → show Disable. is_active=false → show Enable.
  // Task brief referenced `is_disabled` but the canonical field on User is `is_active`.
  // Toggle is mutually exclusive (only one button visible at a time).
  const isCurrentlyActive = user.is_active;
  // The dialog keeps its last copy while it closes (`null` reads as disable).
  const isDelete = pendingConfirm === 'delete';

  return (
    <div className={styles.actionsPanel}>
      <div className={styles.actionRow}>
        <div className={styles.actionLabel}>
          <CreditCardIcon size={16} />
          <span>{t('actionChangePlanLabel')}</span>
        </div>
        <div className={styles.actionControl}>
          <AppSelectAtom<PricingPlan>
            value={selectedPlan}
            onValueChange={setSelectedPlan}
            options={PRICING_PLAN_OPTIONS}
            aria-label={t('actionChangePlanLabel')}
          />
          <ButtonAtom
            size='sm'
            variant='primary'
            onClick={handleChangePlan}
            loading={changePlanMut.isPending}
            disabled={selectedPlan === user.stylist_account?.pricing_plan}>
            {t('actionChangePlanCta')}
          </ButtonAtom>
        </div>
      </div>

      <div className={styles.actionRow}>
        <div className={styles.actionLabel}>
          {isCurrentlyActive ? (
            <ProhibitIcon size={16} />
          ) : (
            <CheckCircleIcon size={16} />
          )}
          <span>
            {isCurrentlyActive
              ? t('actionDisableLabel')
              : t('actionEnableLabel')}
          </span>
        </div>
        <div className={styles.actionControl}>
          {isCurrentlyActive ? (
            <ButtonAtom
              size='sm'
              variant='outlined'
              icon={<ProhibitIcon size={14} />}
              onClick={() => setPendingConfirm('disable')}>
              {t('actionDisableCta')}
            </ButtonAtom>
          ) : (
            <ButtonAtom
              size='sm'
              variant='outlined'
              icon={<CheckCircleIcon size={14} />}
              onClick={handleEnable}
              loading={enableMut.isPending}>
              {t('actionEnableCta')}
            </ButtonAtom>
          )}
        </div>
      </div>

      <div className={styles.actionRow}>
        <div className={styles.actionLabel}>
          <TrashIcon size={16} />
          <span>{t('actionDeleteLabel')}</span>
        </div>
        <div className={styles.actionControl}>
          <ButtonAtom
            size='sm'
            variant='outlined'
            className={styles.actionDangerBtn}
            icon={<TrashIcon size={14} />}
            onClick={() => setPendingConfirm('delete')}>
            {t('actionDeleteCta')}
          </ButtonAtom>
        </div>
      </div>
      {/* Destructive actions confirm in the shared admin dialog; it stays
          open until the request settles and shows the wait in its button. */}
      <AdminConfirmDeleteDialogMolecule
        open={pendingConfirm !== null}
        title={isDelete ? t('confirmDeleteTitle') : t('confirmDisableTitle')}
        message={
          isDelete
            ? t('confirmDeleteMessage', { name: user.name || user.email })
            : t('confirmDisableMessage', { name: user.name || user.email })
        }
        confirmLabel={isDelete ? t('confirmDeleteCta') : t('confirmDisableCta')}
        cancelLabel={t('confirmCancel')}
        isDeleting={isDelete ? deleteMut.isPending : disableMut.isPending}
        onConfirm={isDelete ? handleDelete : handleDisable}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
}
