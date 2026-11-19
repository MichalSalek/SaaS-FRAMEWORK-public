// admin/components/UsersAttentionScope.molecule.tsx
// Scope chip of the users list when it was opened from a menu counter
// (`?attention=payments|stuck`). The count next to the chip is the SAME
// counter the menu shows: the list is cursor-paginated and returns no total.

import { useTranslations } from 'next-intl';
import type { AdminUsersAttentionFilter } from '@kernel/domain/admin/admin-attention.config';
import { useAdminAttentionCounts } from '../hooks/useAdminAttentionCounts';
import { AdminScopeChipMolecule } from './AdminScopeChip.molecule';
import {
  ADMIN_ATTENTION_COPY_VALUES,
  ADMIN_ATTENTION_SIGNALS,
  type AdminAttentionKey,
} from '../admin-attention.config';

/** URL value of the users `attention` filter → the menu counter it lists. */
const USERS_ATTENTION_SIGNAL: Record<
  AdminUsersAttentionFilter,
  AdminAttentionKey
> = {
  payments: 'payments_attention',
  stuck: 'stuck_accounts',
};

export function UsersAttentionScopeMolecule({
  attention,
  hasOtherFilters,
  onRemove,
}: {
  attention: AdminUsersAttentionFilter;
  /**
   * Another filter narrows the list below the menu counter, so the number
   * would no longer describe the rows on screen: it is not shown then.
   */
  hasOtherFilters: boolean;
  onRemove: () => void;
}) {
  const t = useTranslations('admin.attention');
  const { counts } = useAdminAttentionCounts(true);
  const signal = ADMIN_ATTENTION_SIGNALS[USERS_ATTENTION_SIGNAL[attention]];

  return (
    <AdminScopeChipMolecule
      label={t(signal.scopeKey, ADMIN_ATTENTION_COPY_VALUES)}
      countLabel={
        counts !== null && !hasOtherFilters
          ? t(signal.countLabelKey, {
              ...ADMIN_ATTENTION_COPY_VALUES,
              count: counts[signal.key],
            })
          : null
      }
      onRemove={onRemove}
    />
  );
}
