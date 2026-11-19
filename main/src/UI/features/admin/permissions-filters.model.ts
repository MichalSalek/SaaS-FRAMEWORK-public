import type { PermissionView } from './hooks/useAdminPermissions';

export const ALL_PERMISSION_CATEGORIES = '__all__';

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase();

export function filterPermissions(
  permissions: readonly PermissionView[],
  search: string,
  category: string
): PermissionView[] {
  const terms = normalize(search).trim().split(/\s+/).filter(Boolean);
  return permissions.filter(permission => {
    if (
      category !== ALL_PERMISSION_CATEGORIES &&
      permission.category !== category
    ) {
      return false;
    }
    const text = normalize(
      `${permission.event_name} ${permission.description ?? ''} ${permission.category}`
    );
    return terms.every(term => text.includes(term));
  });
}
