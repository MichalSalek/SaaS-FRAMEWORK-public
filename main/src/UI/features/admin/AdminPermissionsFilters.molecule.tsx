// UI/features/admin/AdminPermissionsFilters.molecule.tsx
// The matrix's filters on the shared FilterBar: search, the category and one
// line saying how many permissions are on screen. Behaviour from 2026-10-07
// (search over name, description and category; category with its count;
// „clear”) is unchanged; the parts are the admin's common ones.

import { useTranslations } from 'next-intl';
import { FilterBarMolecule } from '../../components/FilterBar/FilterBar.molecule';
import { AppSelectAtom } from '../../primitives/AppSelect.atom';
import type { PermissionView } from './hooks/useAdminPermissions';
import { ALL_PERMISSION_CATEGORIES } from './permissions-filters.model';

interface Props {
  permissions: readonly PermissionView[];
  search: string;
  category: string;
  onSearch: (value: string) => void;
  onCategory: (value: string) => void;
  onClear: () => void;
  visibleCount: number;
}

export function AdminPermissionsFiltersMolecule({
  permissions,
  search,
  category,
  onSearch,
  onCategory,
  onClear,
  visibleCount,
}: Props) {
  const t = useTranslations('admin.permissions');
  const categories = [
    ...new Set(permissions.map(item => item.category)),
  ].sort();
  // The count rides in the option („ACCOUNT (14)”): a dozen categories in a
  // segmented track scrolled sideways and hid the last ones at every width.
  const withCount = (label: string, count: number) => `${label} (${count})`;

  return (
    <FilterBarMolecule
      search={{
        value: search,
        onChange: onSearch,
        placeholder: t('searchPlaceholder'),
        ariaLabel: t('searchLabel'),
      }}
      activeCount={category === ALL_PERMISSION_CATEGORIES ? 0 : 1}
      onClear={onClear}
      labels={{ filters: t('filtersToggle'), clear: t('clearFilters') }}
      summary={
        <span role='status'>
          {t('filteredCount', {
            count: visibleCount,
            total: permissions.length,
          })}
        </span>
      }>
      <AppSelectAtom
        aria-label={t('categoryFilter')}
        value={category}
        onValueChange={onCategory}
        options={[
          {
            value: ALL_PERMISSION_CATEGORIES,
            label: withCount(t('allCategories'), permissions.length),
          },
          ...categories.map(value => ({
            value,
            label: withCount(
              value,
              permissions.filter(item => item.category === value).length
            ),
          })),
        ]}
      />
    </FilterBarMolecule>
  );
}
