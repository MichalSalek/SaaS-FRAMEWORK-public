// UI/features/admin/AdminLogsPage.filters.molecule.tsx
// Log view controls: a view switch above the shared filter bar (search, presets, dimensions). On a
// narrow bar the dimensions hide under the „Filtry N” button so the first list row is visible at
// once.

import { useTranslations } from 'next-intl';
import {
  LOG_APPLICATIONS,
  LOG_ENVIRONMENTS,
} from '@kernel/domain/admin/log-triage.config';
import { SEND_LOG_TYPES } from '@kernel/domain/admin/send-log.config';
import { ChipAtom } from '../../components/Chip/Chip.atom';
import { FilterBarMolecule } from '../../components/FilterBar/FilterBar.molecule';
import { InputAtom } from '../../components/Input/Input.atom';
import { SegmentedControlMolecule } from '../../components/SegmentedControl/SegmentedControl.molecule';
import { SelectAtom } from '../../components/Select/Select.atom';
import type {
  LogsLocalFilters,
  LogsScope,
  LogsViewMode,
  QuickFilterId,
} from './logs-filters.model';
import { countActiveFilters, QUICK_FILTERS } from './logs-filters.model';
import styles from './AdminLogsPage.module.css';

const ALL = 'all';

type FiltersProps = {
  view: LogsViewMode;
  onViewChange: (view: LogsViewMode) => void;
  scope: LogsScope;
  onScopeChange: (scope: LogsScope) => void;
  local: LogsLocalFilters;
  onLocalChange: (local: LogsLocalFilters) => void;
  activeQuickFilters: readonly QuickFilterId[];
  onQuickFilterToggle: (id: QuickFilterId) => void;
  onClearAll: () => void;
};

export function AdminLogsFiltersMolecule({
  view,
  onViewChange,
  scope,
  onScopeChange,
  local,
  onLocalChange,
  activeQuickFilters,
  onQuickFilterToggle,
  onClearAll,
}: FiltersProps) {
  const t = useTranslations('admin.logs');
  const isStream = view === 'stream';

  const visibleQuickFilters = QUICK_FILTERS.filter(
    filter => filter.availableIn === 'both' || filter.availableIn === view
  );

  const pick = <K extends 'type' | 'application' | 'environment'>(
    key: K,
    value: string
  ) =>
    onScopeChange({
      ...scope,
      [key]: value === ALL ? undefined : (value as LogsScope[K]),
    });

  return (
    <div className={styles.controls}>
      {/* View switch: occurrence stream vs error classes */}
      <SegmentedControlMolecule
        semantics='radio'
        size='sm'
        shape='pill'
        ariaLabel={t('viewSwitchAriaLabel')}
        value={view}
        onChange={onViewChange}
        options={[
          { value: 'stream', label: t('viewStream') },
          { value: 'groups', label: t('viewGroups') },
        ]}
      />

      <FilterBarMolecule
        search={{
          value: local.search,
          onChange: search => onLocalChange({ ...local, search }),
          placeholder: t('searchPlaceholder'),
          ariaLabel: t('searchAriaLabel'),
        }}
        activeCount={countActiveFilters(scope, local)}
        onClear={onClearAll}
        labels={{ filters: t('filtersToggle'), clear: t('clearFilters') }}
        // Presets: one tap sets the full set of dimensions describing a situation.
        quickFilters={
          <div
            className={styles.quickFilters}
            role='group'
            aria-label={t('quickFiltersAriaLabel')}>
            {visibleQuickFilters.map(filter => (
              <ChipAtom
                key={filter.id}
                label={t(filter.labelKey)}
                selected={activeQuickFilters.includes(filter.id)}
                onClick={() => onQuickFilterToggle(filter.id)}
              />
            ))}
          </div>
        }>
        {/* Full-resolution dimensions; the presets above are shortcuts to them */}
        <SelectAtom
          density='compact'
          aria-label={t('filterByTypeAriaLabel')}
          value={scope.type ?? ALL}
          onValueChange={value => pick('type', value)}
          options={[
            { value: ALL, label: t('filterAll') },
            ...SEND_LOG_TYPES.map(value => ({
              value,
              label: t(`type_${value}`),
            })),
          ]}
        />
        <SelectAtom
          density='compact'
          aria-label={t('filterByApplicationAriaLabel')}
          value={scope.application ?? ALL}
          onValueChange={value => pick('application', value)}
          options={[
            { value: ALL, label: t('filterAllApplications') },
            ...LOG_APPLICATIONS.map(value => ({
              value,
              label: t(`application_${value}`),
            })),
          ]}
        />
        <SelectAtom
          density='compact'
          aria-label={t('filterByEnvironmentAriaLabel')}
          value={scope.environment ?? ALL}
          onValueChange={value => pick('environment', value)}
          options={[
            { value: ALL, label: t('filterAllEnvironments') },
            ...LOG_ENVIRONMENTS.map(value => ({
              value,
              label: t(`environment_${value}`),
            })),
          ]}
        />

        {/* The date range applies to single occurrences. The group view aggregates the WHOLE history,
            so a „from/to" date would have nothing to narrow there. */}
        {isStream && (
          <>
            <InputAtom
              type='date'
              className={styles.dateField}
              label={t('dateFromAriaLabel')}
              value={local.dateFrom}
              {...(local.dateTo ? { max: local.dateTo } : {})}
              onChange={e =>
                onLocalChange({ ...local, dateFrom: e.target.value })
              }
            />
            <InputAtom
              type='date'
              className={styles.dateField}
              label={t('dateToAriaLabel')}
              value={local.dateTo}
              {...(local.dateFrom ? { min: local.dateFrom } : {})}
              onChange={e =>
                onLocalChange({ ...local, dateTo: e.target.value })
              }
            />
          </>
        )}
      </FilterBarMolecule>
    </div>
  );
}
