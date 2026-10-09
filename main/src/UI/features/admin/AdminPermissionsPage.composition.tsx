// UI/features/admin/AdminPermissionsPage.composition.tsx
// Admin: role-permission matrix. Editable for custom roles, one save for all
// changed roles, confirmed in a dialog (an RBAC change acts at once).
// The grid and its filters live in components/AdminPermissionsMatrix.organism.

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { ShieldIcon, FloppyDiskIcon } from '@phosphor-icons/react';
import { AdminPageLayoutComposition } from '../../layouts/AdminPageLayout.composition';
import { AppDialogAtom } from '../../primitives/AppDialog.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { useAdminPermissions } from './hooks/useAdminPermissions';
import { useSavePermissions } from './hooks/useSavePermissions';
import {
  PermissionsMatrixOrganism,
  PermissionsMatrixSkeletonMolecule,
  isRoleEditable,
} from './components/AdminPermissionsMatrix.organism';
import {
  HeroCountPillAtom,
  HeroCountPillRowAtom,
} from '../../components/HeroCountPill/HeroCountPill.atom';
import styles from './AdminPermissionsPage.module.css';

export function AdminPermissionsPageComposition() {
  const t = useTranslations('admin.permissions');
  const tButtons = useTranslations('buttons');
  const permissionsQuery = useAdminPermissions();
  const saveMutation = useSavePermissions();
  const [saved, setSaved] = useState(false);
  // Flash timer with cleanup (a bare setTimeout fired setState after unmount).
  useEffect(() => {
    if (!saved) {
      return;
    }
    const timer = window.setTimeout(() => setSaved(false), 2500);
    return () => window.clearTimeout(timer);
  }, [saved]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  /* Build initial matrix: roleId -> Set<permissionId> */
  const serverMatrix = useMemo(() => {
    const matrix: Record<string, Set<string>> = {};
    for (const role of permissionsQuery.data?.roles ?? []) {
      matrix[role.id] = new Set(role.permissions.map(rp => rp.permission.id));
    }
    return matrix;
  }, [permissionsQuery.data]);

  /* Local copy for edits — initialized once from server data */
  const [localMatrix, setLocalMatrix] = useState<Record<string, Set<string>>>(
    {}
  );

  /* Populate local matrix once when server data arrives */
  useEffect(() => {
    if (permissionsQuery.isSuccess && Object.keys(localMatrix).length === 0) {
      setLocalMatrix(serverMatrix);
    }
    // Only run when serverMatrix reference changes (i.e. query data arrives)
    // DECISION (nie usuwaj): run-once populate gated by localMatrix-empty guard —
    // adding localMatrix to deps would re-run on every edit (guarded no-op). The
    // run-once intent is the contract here. React Compiler safely skips this
    // component (load-bearing disable, not a bug).
    // eslint-disable-next-line react-compiler/react-compiler
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverMatrix, permissionsQuery.isSuccess]);

  const effectiveMatrix =
    Object.keys(localMatrix).length > 0 ? localMatrix : serverMatrix;

  /* Count editable roles whose permission set diverged from the server snapshot. */
  const changedRoleCount = useMemo(() => {
    let count = 0;
    for (const [roleId, localSet] of Object.entries(effectiveMatrix)) {
      const role = permissionsQuery.data?.roles.find(
        item => item.id === roleId
      );
      if (!role || !isRoleEditable(role)) {
        continue;
      }
      const serverSet = serverMatrix[roleId] ?? new Set<string>();
      const differs =
        localSet.size !== serverSet.size ||
        [...localSet].some(id => !serverSet.has(id));
      if (differs) {
        count += 1;
      }
    }
    return count;
  }, [effectiveMatrix, serverMatrix, permissionsQuery.data]);

  const handleToggle = useCallback(
    (roleId: string, permissionId: string) => {
      const role = permissionsQuery.data?.roles.find(
        item => item.id === roleId
      );
      if (!role || !isRoleEditable(role)) {
        return;
      }
      setSaved(false);
      setLocalMatrix(prev => {
        const next: Record<string, Set<string>> = {};
        for (const [rid, set] of Object.entries(prev)) {
          next[rid] = new Set(set);
        }
        if (next[roleId] === undefined) {
          next[roleId] = new Set();
        }
        if (next[roleId].has(permissionId)) {
          next[roleId].delete(permissionId);
        } else {
          next[roleId].add(permissionId);
        }
        return next;
      });
    },
    [permissionsQuery.data]
  );

  // DECISION (nie usuwaj tego komentarza): the result of the save is said
  // where it was caused: a failure inside the confirmation (which stays open
  // for a retry), a success next to the save button. No toast: the former
  // pushNewSnackbar(t('saveSuccess')) re-translated an `admin.permissions`
  // string through the `events` namespace, where it is no key.
  const handleSave = useCallback(async () => {
    const roles = permissionsQuery.data?.roles ?? [];
    setSaveFailed(false);
    // One mutation per role, sequentially (API: one role per call). Locked
    // system roles are skipped: the backend rejects them
    // (ADMIN_SYSTEM_ROLE_IMMUTABLE).
    try {
      for (const role of roles) {
        if (!isRoleEditable(role)) {
          continue;
        }
        const localSet = effectiveMatrix[role.id] ?? new Set<string>();
        const serverSet = serverMatrix[role.id] ?? new Set<string>();
        if (
          localSet.size === serverSet.size &&
          [...localSet].every(id => serverSet.has(id))
        ) {
          continue;
        }
        await saveMutation.mutateAsync({
          role_id: role.id,
          permission_ids: Array.from(localSet),
        });
      }
      setSaved(true);
      setConfirmOpen(false);
    } catch {
      setSaveFailed(true);
    }
  }, [permissionsQuery.data, saveMutation, effectiveMatrix, serverMatrix]);

  const data = permissionsQuery.data;
  const roles = data?.roles ?? [];
  const allPermissions = data?.allPermissions ?? [];
  const isSaving = saveMutation.isPending;

  // The counts and the save stand in the header only once the matrix is read:
  // a failed first load is not „0 permissions”. The save and its one status
  // line are always there, so the first ticked box moves nothing.
  const meta =
    data === undefined ? undefined : (
      <div className={styles.heroCluster}>
        <HeroCountPillRowAtom>
          {/* The number of permissions is said once, in the filter bar's
              sentence, where it changes with the filter. */}
          <HeroCountPillAtom icon={<ShieldIcon size={13} weight='fill' />}>
            {t('heroPillRoles', { count: roles.length })}
          </HeroCountPillAtom>
        </HeroCountPillRowAtom>
        <div className={styles.headerSave}>
          <p className={styles.saveHint} role='status'>
            {saved
              ? t('savedBadge')
              : changedRoleCount > 0
                ? t('savePendingHint', { count: changedRoleCount })
                : t('saveIdle')}
          </p>
          <ButtonAtom
            size='sm'
            variant={changedRoleCount > 0 ? 'primary' : 'outlined'}
            icon={<FloppyDiskIcon size={16} aria-hidden='true' />}
            onClick={() => {
              setSaveFailed(false);
              setConfirmOpen(true);
            }}
            disabled={changedRoleCount === 0}
            loading={isSaving}>
            {t('saveButton')}
          </ButtonAtom>
        </div>
      </div>
    );

  return (
    <AdminPageLayoutComposition
      documentTitle={t('pageTitle')}
      eyebrow={t('heroEyebrow')}
      title={t('pageTitle')}
      subtitle={t('heroSubtitle')}
      meta={meta}>
      {/* Only a failed FIRST load stands alone. A failed refresh after a save
          keeps the matrix (and every unsaved box) with the retry above it. */}
      {permissionsQuery.isError && (
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={tButtons('retry')}
          onRetry={() => void permissionsQuery.refetch()}
          isRetrying={permissionsQuery.isFetching}
        />
      )}
      {permissionsQuery.isLoading ? (
        <PermissionsMatrixSkeletonMolecule />
      ) : data === undefined ? null : roles.length > 0 &&
        allPermissions.length > 0 ? (
        <PermissionsMatrixOrganism
          roles={roles}
          allPermissions={allPermissions}
          localMatrix={effectiveMatrix}
          onToggle={handleToggle}
        />
      ) : (
        <EmptyStateAtom
          size='page'
          title={t('emptyMessage')}
          titleAs='h2'
          description={t('emptyDescription')}
        />
      )}

      <AppDialogAtom
        open={confirmOpen}
        onOpenChange={next => {
          // Held open until the save settles: the wait shows in the button.
          if (!next && !isSaving) {
            setConfirmOpen(false);
          }
        }}
        disablePointerDismissal>
        <AppDialogAtom.Content
          title={t('confirmSaveTitle')}
          description={t('confirmSaveMessage', { count: changedRoleCount })}
          closeDisabled={isSaving}>
          {saveFailed && (
            <p className={styles.dialogError} role='alert'>
              {t('saveError')}
            </p>
          )}
          <AppDialogAtom.Actions>
            <ButtonAtom
              variant='outlined'
              size='md'
              onClick={() => setConfirmOpen(false)}
              disabled={isSaving}>
              {t('confirmCancel')}
            </ButtonAtom>
            <ButtonAtom
              variant='primary'
              size='md'
              onClick={() => void handleSave()}
              loading={isSaving}>
              {t('confirmSaveCta')}
            </ButtonAtom>
          </AppDialogAtom.Actions>
        </AppDialogAtom.Content>
      </AppDialogAtom>
    </AdminPageLayoutComposition>
  );
}
