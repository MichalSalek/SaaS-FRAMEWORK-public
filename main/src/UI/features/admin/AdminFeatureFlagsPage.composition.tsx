// UI/features/admin/AdminFeatureFlagsPage.composition.tsx
// Admin feature flags: three numbers (the overdue one filters the list), then
// one panel per category. A toggle is optimistic, shows that it is saving and
// reports a failure in its own row.
// Split by responsibility: feature-flags.model.ts (retirement, grouping),
// .row.molecule.tsx (one flag), .group.organism.tsx (one category), this file
// (the page: reads, the filter, the toggle bookkeeping).

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AdminPageLayoutComposition } from '../../layouts/AdminPageLayout.composition';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import {
  StatTileBandMolecule,
  StatTileMolecule,
} from '../../components/StatTile/StatTile.molecule';
import { useAdminFeatureFlags } from './hooks/useAdminFeatureFlags';
import { useToggleFeatureFlag } from './hooks/useToggleFeatureFlag';
import { FLAG_CATEGORIES, groupFlags, isOverdue } from './feature-flags.model';
import {
  FlagGroupOrganism,
  FlagGroupSkeletonOrganism,
} from './AdminFeatureFlagsPage.group.organism';

/** Add or remove one key of a set held in state. */
const withKey = (
  keys: ReadonlySet<string>,
  key: string,
  present: boolean
): ReadonlySet<string> => {
  if (keys.has(key) === present) {
    return keys;
  }
  const next = new Set(keys);
  if (present) {
    next.add(key);
  } else {
    next.delete(key);
  }
  return next;
};

export function AdminFeatureFlagsPageComposition() {
  const t = useTranslations('admin.featureFlags');
  const tButtons = useTranslations('buttons');
  const flagsQuery = useAdminFeatureFlags();
  const toggleMutation = useToggleFeatureFlag();
  // A SET, not one key: two quick toggles are two parallel mutations, and only
  // the switch in flight is disabled (not every switch on the page).
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(
    new Set()
  );
  const pendingKeysRef = useRef(new Set<string>());
  const [failedKeys, setFailedKeys] = useState<ReadonlySet<string>>(new Set());
  const [overdueOnly, setOverdueOnly] = useState(false);

  const flags = flagsQuery.data ?? [];
  // A failed refetch keeps the last read (TQ v5). An EMPTY last read under an
  // error is not a confirmed „no flags”: treat it as unknown, so the page
  // shows the error with retry instead of the empty state.
  const hasFlags =
    flagsQuery.data !== undefined &&
    !(flagsQuery.isError && flagsQuery.data.length === 0);
  const isLoading = flagsQuery.isLoading;

  const enabledCount = flags.filter(flag => flag.is_enabled).length;
  const overdueFlags = flags.filter(flag => isOverdue(flag));
  const grouped = groupFlags(overdueOnly ? overdueFlags : flags);
  const visibleCategories = FLAG_CATEGORIES.filter(
    category => grouped[category].length > 0
  );

  const handleToggle = async (key: string, nextEnabled: boolean) => {
    if (pendingKeysRef.current.has(key)) {
      return;
    }
    pendingKeysRef.current.add(key);
    setPendingKeys(new Set(pendingKeysRef.current));
    setFailedKeys(prev => withKey(prev, key, false));
    try {
      await toggleMutation.mutateAsync({ key, is_enabled: nextEnabled });
    } catch {
      // The mutation hook rolled back this flag only; the row says it failed.
      setFailedKeys(prev => withKey(prev, key, true));
    } finally {
      pendingKeysRef.current.delete(key);
      setPendingKeys(new Set(pendingKeysRef.current));
    }
  };

  const loadError = flagsQuery.isError ? (
    <ErrorStateMolecule
      message={t('errorMessage')}
      retryLabel={tButtons('retry')}
      onRetry={() => void flagsQuery.refetch()}
      isRetrying={flagsQuery.isFetching}
    />
  ) : null;

  return (
    <AdminPageLayoutComposition
      documentTitle={t('pageTitle')}
      eyebrow={t('eyebrow')}
      title={t('title')}
      subtitle={t('subtitle')}>
      {/* A failed refresh keeps the last good read under the error (a failed
          toggle was already rolled back in its own row). */}
      {loadError}
      {isLoading ? (
        <>
          <FlagTiles
            loading
            enabled={0}
            disabled={0}
            overdue={0}
            overdueOnly={false}
            onOverdueOnly={setOverdueOnly}
          />
          <FlagGroupSkeletonOrganism rows={1} />
          <FlagGroupSkeletonOrganism rows={3} />
        </>
      ) : !hasFlags ? null : flags.length === 0 ? (
        // No flags at all is said ONCE: no tiles of zeros above it.
        <EmptyStateAtom
          size='page'
          title={t('emptyMessage')}
          titleAs='h2'
          description={t('emptyDescription')}
        />
      ) : (
        <>
          <FlagTiles
            loading={false}
            enabled={enabledCount}
            disabled={flags.length - enabledCount}
            overdue={overdueFlags.length}
            overdueOnly={overdueOnly}
            onOverdueOnly={setOverdueOnly}
          />
          {visibleCategories.length === 0 ? (
            <EmptyStateAtom
              title={t('overdueEmptyTitle')}
              titleAs='h2'
              description={t('overdueEmptyDescription')}
              action={
                <ButtonAtom
                  size='sm'
                  variant='outlined'
                  onClick={() => setOverdueOnly(false)}>
                  {t('showAll')}
                </ButtonAtom>
              }
            />
          ) : (
            visibleCategories.map(category => (
              <FlagGroupOrganism
                key={category}
                category={category}
                flags={grouped[category]}
                pendingKeys={pendingKeys}
                failedKeys={failedKeys}
                onToggle={(key, enabled) => void handleToggle(key, enabled)}
              />
            ))
          )}
        </>
      )}
    </AdminPageLayoutComposition>
  );
}

/* The page's numbers. „Przeterminowane” is the door to exactly the flags it
   counts: it filters the list below (inverted ink while on). The on / off
   numbers count rows that are all on screen under them, so they are
   information, not filters: a flag toggled under an „on only” filter would
   vanish from under the finger. */
function FlagTiles({
  loading,
  enabled,
  disabled,
  overdue,
  overdueOnly,
  onOverdueOnly,
}: {
  loading: boolean;
  enabled: number;
  disabled: number;
  overdue: number;
  overdueOnly: boolean;
  onOverdueOnly: (next: boolean) => void;
}) {
  const t = useTranslations('admin.featureFlags');
  return (
    <StatTileBandMolecule ariaLabel={t('statsAriaLabel')}>
      <StatTileMolecule
        label={t('statEnabled')}
        value={enabled}
        loading={loading}
      />
      <StatTileMolecule
        label={t('statDisabled')}
        value={disabled}
        loading={loading}
      />
      <StatTileMolecule
        label={t('statOverdue')}
        value={overdue}
        loading={loading}
        // A filter (a real button with its hint) only when there is something
        // to filter, or to switch it back off; at 0 it is plain information.
        {...((overdue > 0 || overdueOnly) && {
          hint: t('statOverdueHint'),
          selected: overdueOnly,
          onSelect: () => onOverdueOnly(!overdueOnly),
        })}
      />
    </StatTileBandMolecule>
  );
}
