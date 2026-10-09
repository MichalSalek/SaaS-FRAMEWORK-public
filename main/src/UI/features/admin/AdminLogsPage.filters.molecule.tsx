// UI/features/admin/AdminLogsPage.filters.molecule.tsx
// Sterowanie widokiem logów: przełącznik widoku nad wspólnym paskiem filtrów
// (szukajka, presety, wymiary). Na wąskim pasku wymiary chowają się pod
// przyciskiem „Filtry N”, żeby pierwszy wiersz listy był widać od razu.

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
import { AppSelectAtom } from '../../primitives/AppSelect.atom';
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
      {/* Przełącznik widoku: strumień wystąpień vs klasy błędów */}
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
        // Presety: jedno dotknięcie ustawia komplet wymiarów opisujących sytuację.
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
        {/* Wymiary pełnej rozdzielczości — presety wyżej są ich skrótami */}
        <AppSelectAtom
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
        <AppSelectAtom
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
        <AppSelectAtom
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

        {/* Zakres dat dotyczy pojedynczych wystąpień. Widok grup agreguje CAŁĄ
            historię, więc data „od/do" nie miałaby tam czego zawężać. */}
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
