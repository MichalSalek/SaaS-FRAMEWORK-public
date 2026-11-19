// admin/components/UsersTable.helpers.ts
// Types and pure helpers of the users table.

import type { AdminUserRecord } from '../hooks/useAdminUsers';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import styles from '../AdminUsersPage.module.css';

export type SortKey =
  | 'name'
  | 'email'
  | 'role'
  | 'plan'
  | 'status'
  | 'createdAt'
  | 'lastLogin'
  | 'photos'
  | 'city';
export type SortDir = 'asc' | 'desc';

export function getPlanClass(plan: string | null | undefined): string {
  if (!plan) {
    return '';
  }
  const map: Record<string, string> = {
    [PricingPlanValue.FREE]: styles.planFree ?? '',
    [PricingPlanValue.PRO]: styles.planPro ?? '',
    [PricingPlanValue.PRO_PLUS]: styles.planProPlus ?? '',
    [PricingPlanValue.STUDIO]: styles.planStudio ?? '',
    [PricingPlanValue.SCALE]: styles.planScale ?? '',
  };
  return map[plan] ?? '';
}

/* Returns the state KEY and the role token, not a CSS class: StatusPill draws the pill, and this
 * function only answers "what state is this account in". The key is a union (not a bare string), so
 * TS forces the label map at the call site to be complete, with no fallback letting a raw literal
 * through to the UI. */
export type AdminUserStatusKey = 'Disabled' | 'Trial' | 'Active';

export function getStatusInfo(user: AdminUserRecord): {
  label: AdminUserStatusKey;
  color: string;
} {
  if (!user.is_active) {
    return { label: 'Disabled', color: 'var(--color-error)' };
  }
  if (user.stylist_account?.trial_ends_at) {
    const trialEnds = new Date(user.stylist_account.trial_ends_at);
    if (trialEnds.getTime() > Date.now()) {
      return { label: 'Trial', color: 'var(--color-warning)' };
    }
  }
  return { label: 'Active', color: 'var(--color-success)' };
}
