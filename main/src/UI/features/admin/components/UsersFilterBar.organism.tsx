// admin/components/UsersFilterBar.organism.tsx
// Filters of the users list on the shared filter bar: search plus the role,
// plan, account status and payment status selects. On a narrow bar the
// selects sit under the „Filtry N” button.

import { useTranslations } from 'next-intl';
import {
  AccountStatusValue,
  AccountTypeValue,
  PaymentStatusValue,
} from '@kernel/models/db_models.generated.dto';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import type {
  AccountStatus,
  AccountType,
  PaymentStatus,
} from '@kernel/models/db_models.generated.dto';
import { FilterBarMolecule } from '../../../components/FilterBar/FilterBar.molecule';
import { AppSelectAtom } from '../../../primitives/AppSelect.atom';
import { ROLE_FILTER_NO_ROLE } from '../AdminUsersPage.helpers';

/* ─── Filter types ─── */

export type RoleFilter = 'all' | AccountType | typeof ROLE_FILTER_NO_ROLE;
export type PlanFilter = 'all' | PricingPlan;
export type AccountStatusFilter = 'all' | AccountStatus;
export type PaymentStatusFilter = 'all' | PaymentStatus;

export interface UsersFilterBarProps {
  search: string;
  role: RoleFilter;
  plan: PlanFilter;
  accountStatus: AccountStatusFilter;
  paymentStatus: PaymentStatusFilter;
  onSearch: (v: string) => void;
  onRole: (v: RoleFilter) => void;
  onPlan: (v: PlanFilter) => void;
  onAccountStatus: (v: AccountStatusFilter) => void;
  onPaymentStatus: (v: PaymentStatusFilter) => void;
  onClear: () => void;
}

/* ─── Component ─── */

export function UsersFilterBarOrganism({
  search,
  role,
  plan,
  accountStatus,
  paymentStatus,
  onSearch,
  onRole,
  onPlan,
  onAccountStatus,
  onPaymentStatus,
  onClear,
}: UsersFilterBarProps) {
  const t = useTranslations('admin.users');

  const activeCount = [role, plan, accountStatus, paymentStatus].filter(
    value => value !== 'all'
  ).length;

  return (
    <FilterBarMolecule
      // Names and e-mail addresses: the bar's search has no auto-capital and
      // no spell underline.
      search={{
        value: search,
        onChange: onSearch,
        placeholder: t('searchPlaceholder'),
        ariaLabel: t('searchAriaLabel'),
      }}
      activeCount={activeCount}
      onClear={onClear}
      labels={{ filters: t('filtersToggle'), clear: t('clearFilters') }}>
      <AppSelectAtom<RoleFilter>
        aria-label={t('filterByRole')}
        value={role}
        onValueChange={onRole}
        options={[
          { value: 'all', label: t('filterAllRoles') },
          { value: AccountTypeValue.STYLIST, label: t('roleStylist') },
          { value: AccountTypeValue.CLIENT, label: t('roleClient') },
          { value: ROLE_FILTER_NO_ROLE, label: t('roleOnboardingPending') },
        ]}
      />
      <AppSelectAtom<PlanFilter>
        aria-label={t('filterByPlan')}
        value={plan}
        onValueChange={onPlan}
        options={[
          { value: 'all', label: t('filterAllPlans') },
          ...Object.values(PricingPlanValue).map(value => ({
            value,
            label: value,
          })),
        ]}
      />
      <AppSelectAtom<AccountStatusFilter>
        aria-label={t('filterByAccountStatus')}
        value={accountStatus}
        onValueChange={onAccountStatus}
        options={[
          { value: 'all', label: t('filterAllAccountStatuses') },
          ...Object.values(AccountStatusValue).map(value => ({
            value,
            label: value,
          })),
        ]}
      />
      <AppSelectAtom<PaymentStatusFilter>
        aria-label={t('filterByPaymentStatus')}
        value={paymentStatus}
        onValueChange={onPaymentStatus}
        options={[
          { value: 'all', label: t('filterAllPaymentStatuses') },
          ...Object.values(PaymentStatusValue).map(value => ({
            value,
            label: value,
          })),
        ]}
      />
    </FilterBarMolecule>
  );
}
