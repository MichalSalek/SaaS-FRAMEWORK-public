import { AppDialogAtom } from '../../primitives/AppDialog.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
// Shared runtime editor used by feature flags and ordinary configuration.
// Admin runtime config editor: one setting row per entry, a value editor of
// the entry's type, a save per row that reports next to itself.
// The row and its skeleton live in AdminConfigPage.parts.molecule.tsx.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { RuntimeConfigEntry } from '@kernel/models/admin/admin.dto';
import { AdminPanelMolecule } from './components/AdminPanel.molecule';
import {
  RUNTIME_FEATURE_CATEGORIES,
  runtimeFeatureCategory,
} from '@kernel/domain/feature-flags/runtime-feature-controls.config';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import {
  HeroCountPillAtom,
  HeroCountPillRowAtom,
} from '../../components/HeroCountPill/HeroCountPill.atom';
import { useAdminConfig } from './hooks/useAdminConfig';
import { useLeaveGuard } from '../../shared/hooks/useLeaveGuard';
import { useUpdateConfig } from './hooks/useUpdateConfig';
import {
  ConfigItemMolecule,
  ConfigItemSkeletonMolecule,
  type ConfigRowStatus,
} from './AdminConfigPage.parts.molecule';
import styles from './AdminConfigPage.module.css';

const SKELETON_ROWS = 6;

export function AdminRuntimeConfigEditorOrganism({
  scope,
}: {
  scope: 'settings' | 'features';
}) {
  const t = useTranslations('admin.config');
  const tButtons = useTranslations('buttons');
  const {
    configs: allConfigs,
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useAdminConfig();
  const configs = allConfigs?.filter(
    entry =>
      (runtimeFeatureCategory(entry.key, entry.value_type) !== null) ===
      (scope === 'features')
  );
  const tFlags = useTranslations('admin.featureFlags');
  const updateConfig = useUpdateConfig();
  const [pendingFreeEnable, setPendingFreeEnable] =
    useState<RuntimeConfigEntry | null>(null);

  // Local draft values keyed by entry id; absent = the server value.
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [savedId, setSavedId] = useState<string | null>(null);
  // Rows whose last save failed: the row says so until it is edited or saved.
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(new Set());
  // Independent rows may save concurrently; each request owns its pending state.
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(new Set());
  const savingIdsRef = useRef(new Set<string>());

  // The „saved” word goes out after 2 s; the cleanup covers an unmount and a
  // second row saved meanwhile.
  useEffect(() => {
    if (savedId === null) {
      return;
    }
    const timer = window.setTimeout(() => setSavedId(null), 2000);
    return () => window.clearTimeout(timer);
  }, [savedId]);

  const getLocalValue = (entry: RuntimeConfigEntry): string =>
    localValues[entry.id] ?? entry.value;

  const isDirty = (entry: RuntimeConfigEntry): boolean => {
    const local = localValues[entry.id];
    return local !== undefined && local !== entry.value;
  };

  const clearFailed = (id: string) =>
    setFailedIds(prev => {
      if (!prev.has(id)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  const handleValueChange = (id: string, value: string) => {
    setLocalValues(prev => ({ ...prev, [id]: value }));
    setSavedId(null);
    clearFailed(id);
  };

  // The freshest field values through a ref: onSuccess compares the SAVED
  // value with what the admin has in the field now, so an edit made during
  // the save does not get a false „saved”.
  const localValuesRef = useRef(localValues);
  localValuesRef.current = localValues;
  // DECISION: the result of a save is said in the row next to its button, not in a toast: the
  // snackbar re-translates its argument through the `events` namespace, where an `admin.config`
  // string is no key.
  const handleSave = async (entry: RuntimeConfigEntry) => {
    if (savingIdsRef.current.has(entry.id)) {
      return false;
    }
    const value = localValues[entry.id] ?? entry.value;
    savingIdsRef.current.add(entry.id);
    setSavingIds(new Set(savingIdsRef.current));
    clearFailed(entry.id);
    try {
      await updateConfig.mutateAsync({ key: entry.key, value });
      const current = localValuesRef.current[entry.id] ?? entry.value;
      if (current === value) {
        setSavedId(entry.id);
      }
      return true;
    } catch {
      setFailedIds(prev => new Set(prev).add(entry.id));
      return false;
    } finally {
      savingIdsRef.current.delete(entry.id);
      setSavingIds(new Set(savingIdsRef.current));
    }
  };

  const rowStatus = (entry: RuntimeConfigEntry): ConfigRowStatus =>
    failedIds.has(entry.id)
      ? 'failed'
      : savedId === entry.id
        ? 'saved'
        : isDirty(entry)
          ? 'dirty'
          : 'idle';

  const dirtyCount = configs ? configs.filter(c => isDirty(c)).length : 0;
  useLeaveGuard({ when: dirtyCount > 0, message: t('discardDraftConfirm') });

  // Only a resolved list has a count: a failed first load is not „0 entries”.
  // Both pills are always there, so the first edit moves nothing in the header.
  const metaPills =
    configs !== undefined ? (
      <HeroCountPillRowAtom>
        <HeroCountPillAtom>
          {t('metaEntries', { count: configs.length })}
        </HeroCountPillAtom>
        <HeroCountPillAtom tone={dirtyCount > 0 ? 'alert' : 'default'}>
          {t('metaUnsaved', { count: dirtyCount })}
        </HeroCountPillAtom>
      </HeroCountPillRowAtom>
    ) : undefined;

  const loadError = isError ? (
    <ErrorStateMolecule
      message={t('loadError')}
      retryLabel={tButtons('retry')}
      onRetry={() => void refetch()}
      isRetrying={isFetching}
    />
  ) : null;

  const renderRows = (entries: RuntimeConfigEntry[]) => (
    <ul
      className={`${styles.list} ${scope === 'features' ? styles.embeddedList : ''}`}>
      {entries.map(entry => (
        <ConfigItemMolecule
          key={entry.id}
          entry={entry}
          localValue={getLocalValue(entry)}
          status={rowStatus(entry)}
          isDirty={isDirty(entry)}
          isPending={savingIds.has(entry.id)}
          onValueChange={handleValueChange}
          onSave={row => {
            if (
              row.key === 'FREE_EMAIL_MODE' &&
              getLocalValue(row) === 'ON' &&
              row.value !== 'ON'
            ) {
              setPendingFreeEnable(row);
            } else {
              void handleSave(row);
            }
          }}
          t={t}
        />
      ))}
    </ul>
  );

  return (
    <>
      {scope === 'settings' && metaPills}
      {/* A failed refresh keeps the last good read and every unsaved draft;
          the error with retry stands above the list, outside its box. */}
      <AppDialogAtom
        open={pendingFreeEnable !== null}
        onOpenChange={open => {
          if (!open && !updateConfig.isPending) {
            setPendingFreeEnable(null);
          }
        }}>
        <AppDialogAtom.Content
          title={t('confirmFreeTitle')}
          description={t('confirmFreeBody')}
          closeDisabled={updateConfig.isPending}>
          <AppDialogAtom.Actions>
            <ButtonAtom
              variant='outlined'
              disabled={updateConfig.isPending}
              onClick={() => setPendingFreeEnable(null)}>
              {t('confirmFreeCancel')}
            </ButtonAtom>
            <ButtonAtom
              loading={updateConfig.isPending}
              onClick={() => {
                if (pendingFreeEnable) {
                  void handleSave(pendingFreeEnable).then(saved => {
                    if (saved) {
                      setPendingFreeEnable(null);
                    }
                  });
                }
              }}>
              {t('confirmFreeCta')}
            </ButtonAtom>
          </AppDialogAtom.Actions>
        </AppDialogAtom.Content>
      </AppDialogAtom>
      {loadError}
      {isLoading ? (
        <ul className={styles.list} aria-busy='true'>
          {Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <ConfigItemSkeletonMolecule key={i} />
          ))}
        </ul>
      ) : configs === undefined ? null : configs.length === 0 ? (
        <EmptyStateAtom
          size='page'
          title={t('emptyTitle')}
          titleAs='h2'
          description={t('emptyDescription')}
        />
      ) : scope === 'features' ? (
        RUNTIME_FEATURE_CATEGORIES.map(category => {
          const entries = configs.filter(
            entry =>
              runtimeFeatureCategory(entry.key, entry.value_type) === category
          );
          return entries.length > 0 ? (
            <AdminPanelMolecule
              key={category}
              title={tFlags(`categories.${category}`)}
              aside={tFlags('categoryCount', { count: entries.length })}>
              {renderRows(entries)}
            </AdminPanelMolecule>
          ) : null;
        })
      ) : (
        renderRows(configs)
      )}
    </>
  );
}
