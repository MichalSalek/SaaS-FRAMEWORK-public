import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSION_CATEGORIES,
  filterPermissions,
} from './permissions-filters.model';
import type { PermissionView } from './hooks/useAdminPermissions';

const permissions: PermissionView[] = [
  {
    id: 'name',
    event_name: 'USER_CHANGE_NAME',
    category: 'USER',
    description: 'Zmiana nazwy użytkownika',
    is_system: true,
  },
  {
    id: 'gallery',
    event_name: 'GET_GALLERY_RECORDS',
    category: 'GALLERY',
    description: null,
    is_system: true,
  },
];

describe('permission filters', () => {
  it('shows every item when filters are cleared', () => {
    expect(
      filterPermissions(permissions, ' ', ALL_PERMISSION_CATEGORIES)
    ).toEqual(permissions);
  });
  it('searches event names without case sensitivity', () => {
    expect(
      filterPermissions(
        permissions,
        'change_name',
        ALL_PERMISSION_CATEGORIES
      ).map(item => item.id)
    ).toEqual(['name']);
  });
  it('searches descriptions using all words without accents', () => {
    expect(
      filterPermissions(
        permissions,
        '  zmiana  uzytkownika ',
        ALL_PERMISSION_CATEGORIES
      ).map(item => item.id)
    ).toEqual(['name']);
  });
  it('combines search with category', () => {
    expect(filterPermissions(permissions, 'user', 'GALLERY')).toEqual([]);
    expect(
      filterPermissions(permissions, '', 'GALLERY').map(item => item.id)
    ).toEqual(['gallery']);
  });
  it('does not mutate the supplied permission list', () => {
    filterPermissions(permissions, 'name', 'USER');
    expect(permissions).toHaveLength(2);
  });
});
