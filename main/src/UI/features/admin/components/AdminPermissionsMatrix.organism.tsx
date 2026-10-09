// admin/components/AdminPermissionsMatrix.organism.tsx
// Role-permission matrix (filters + the grid) and its loading skeleton.

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { LockKeyIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { CheckboxAtom } from '../../../components/Checkbox/Checkbox.atom';
import { EmptyStateAtom } from '../../../components/EmptyState/EmptyState.atom';
import { SkeletonAtom } from '../../../components/Skeleton/Skeleton.atom';
import { StatusPillAtom } from '../../../components/StatusPill/StatusPill.atom';
import type {
  RoleWithPermissions,
  PermissionView,
} from '../hooks/useAdminPermissions';
import { SoftBreakTextAtom } from '../../../components/SoftBreakText/SoftBreakText.atom';
import styles from '../AdminPermissionsPage.module.css';
import { AdminPermissionsFiltersMolecule } from '../AdminPermissionsFilters.molecule';
import {
  ALL_PERMISSION_CATEGORIES,
  filterPermissions,
} from '../permissions-filters.model';

// DECISION (nie usuwaj tego komentarza):
// All system-role permissions come from configuration, including signed-out,
// stylist and client roles. Backend rejects their mutation before any write;
// the matrix must lock the same is_system flag rather than just MASTER_ADMIN.
export const isRoleEditable = (
  role: Pick<RoleWithPermissions, 'is_system'>
): boolean => !role.is_system;

const ROLE_LABEL_KEY = {
  CLIENT_ROLE: 'roles.CLIENT_ROLE',
  STYLIST_ROLE: 'roles.STYLIST_ROLE',
  MASTER_ADMIN: 'roles.MASTER_ADMIN',
  NOT_LOGGED_IN: 'roles.NOT_LOGGED_IN',
} as const;

type KnownRoleName = keyof typeof ROLE_LABEL_KEY;

function knownRoleName(name: string): KnownRoleName | null {
  return Object.prototype.hasOwnProperty.call(ROLE_LABEL_KEY, name)
    ? (name as KnownRoleName)
    : null;
}

/* ─── Skeleton: the filter bar's box, then rows of a name and four marks ─── */

const SKELETON_ROWS = 8;
const SKELETON_ROLES = 4;

export function PermissionsMatrixSkeletonMolecule() {
  return (
    <div className={styles.stack} aria-busy='true'>
      <SkeletonAtom variant='rect' width='100%' height={76} />
      <div className={styles.matrixWrapper}>
        {Array.from({ length: SKELETON_ROWS }, (_, row) => (
          <div key={row} className={styles.skeletonRow}>
            <SkeletonAtom variant='text' width='60%' height={16} />
            {Array.from({ length: SKELETON_ROLES }, (__, cell) => (
              <SkeletonAtom key={cell} variant='rect' width={20} height={20} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Permissions Matrix ─── */

interface PermissionsMatrixProps {
  roles: RoleWithPermissions[];
  allPermissions: PermissionView[];
  localMatrix: Record<string, Set<string>>;
  onToggle: (roleId: string, permissionId: string) => void;
}

export function PermissionsMatrixOrganism({
  roles,
  allPermissions,
  localMatrix,
  onToggle,
}: PermissionsMatrixProps) {
  const t = useTranslations('admin.permissions');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(ALL_PERMISSION_CATEGORIES);
  const clearFilters = () => {
    setSearch('');
    setCategory(ALL_PERMISSION_CATEGORIES);
  };
  const visiblePermissions = filterPermissions(
    allPermissions,
    search,
    category
  );
  const allLocked = roles.every(role => !isRoleEditable(role));
  const roleLabel = (name: string): string => {
    const known = knownRoleName(name);
    return known ? t(ROLE_LABEL_KEY[known]) : name;
  };

  return (
    <div className={styles.stack}>
      <AdminPermissionsFiltersMolecule
        permissions={allPermissions}
        search={search}
        category={category}
        onSearch={setSearch}
        onCategory={setCategory}
        onClear={clearFilters}
        visibleCount={visiblePermissions.length}
      />
      {allLocked && <p className={styles.matrixNote}>{t('allLockedNote')}</p>}
      {visiblePermissions.length === 0 ? (
        <EmptyStateAtom
          title={t('noFilterResults')}
          titleAs='h2'
          action={
            <ButtonAtom size='sm' variant='outlined' onClick={clearFilters}>
              {t('clearFilters')}
            </ButtonAtom>
          }
        />
      ) : (
        // DECISION (nie usuwaj tego komentarza) — a raw <table>, on purpose:
        // this is a genuine two-axis matrix (permissions by roles), the one
        // shape DataTableOrganism does not carry (it turns a row into a card,
        // and a card per permission with four labelled checkboxes was 186
        // cards and ~30 screens on a phone, with no way to compare roles).
        // The grid is the same at every width: it scrolls inside its own
        // frame with the permission column and the role header sticky, and
        // the permission column takes its width from the frame (container
        // units) and a role column is as narrow as a mark and a short name
        // allow, so on a phone two roles are in view and the third is cut by
        // the frame's edge: that cut column is the cue that it scrolls.
        // The scroller is keyboard-reachable through the checkboxes inside it.
        <div
          className={styles.matrixWrapper}
          role='region'
          aria-label={t('matrixAriaLabel')}>
          <table className={styles.matrix}>
            <thead>
              <tr>
                <th scope='col'>{t('columnPermission')}</th>
                {roles.map(role => (
                  <th key={role.id} scope='col' className={styles.roleCol}>
                    <span className={styles.roleHeading}>
                      <span className={styles.roleLabel}>
                        {roleLabel(role.name)}
                      </span>
                      {knownRoleName(role.name) !== null && (
                        <SoftBreakTextAtom className={styles.roleKey}>
                          {role.name}
                        </SoftBreakTextAtom>
                      )}
                      {/* Locked and „system” are one fact (isRoleEditable):
                          one pill, not two badges. It marks a column only
                          when roles DIFFER; when every role is locked the
                          note above the grid says it once. */}
                      {!allLocked && !isRoleEditable(role) && (
                        <StatusPillAtom
                          color='var(--color-text-secondary)'
                          icon={
                            <LockKeyIcon
                              size={14}
                              weight='fill'
                              aria-hidden='true'
                            />
                          }
                          label={t('lockedColumnBadge')}
                        />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visiblePermissions.map(permission => (
                <tr key={permission.id}>
                  <th scope='row'>
                    <SoftBreakTextAtom className={styles.permissionName}>
                      {permission.event_name}
                    </SoftBreakTextAtom>
                    {/* The description used to live in a `title` tooltip, which
                        a phone never shows; the search matches on it, so it
                        has to be readable. */}
                    {permission.description ? (
                      <span className={styles.permissionDescription}>
                        {permission.description}
                      </span>
                    ) : null}
                    {permission.category && (
                      <span className={styles.permissionCategory}>
                        {permission.category}
                      </span>
                    )}
                  </th>
                  {roles.map(role => (
                    <td key={role.id}>
                      <CheckboxAtom
                        checked={
                          localMatrix[role.id]?.has(permission.id) ?? false
                        }
                        onChange={() => onToggle(role.id, permission.id)}
                        disabled={!isRoleEditable(role)}
                        aria-label={`${roleLabel(role.name)}: ${permission.event_name}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
