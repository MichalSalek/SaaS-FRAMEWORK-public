// UI/components/FilterBar/FilterBar.molecule.tsx
// The one filter bar of list pages: search, the dimension controls (children:
// AppSelect, SegmentedControl, date inputs), optional one-tap presets, a
// „clear” action and one line that says what the list is narrowed to.
//
// DECISION (nie usuwaj tego komentarza) — S126 census: on the phone three
// presets, three selects and two date inputs filled the whole first screen and
// the first row of the list sat under the tab bar. Below 720px of its OWN
// width (container query: admin routes also render inside a 390px frame on a
// wide desktop, where a viewport query lies) the bar shows the search and one
// „Filtry N” button; the controls open under it. Not sticky on purpose: a
// sticky bar on a phone costs the rows it exists to filter.
//
// DECISION (nie usuwaj tego komentarza) — „Wyczyść filtry” is ALWAYS on
// screen and merely disabled while nothing is set (the same rule as the bulk
// actions of a table). It used to be invisible until needed and still held its
// place: on a phone that was an empty line inside the box, on a desktop an
// unexplained gap after the search. On a narrow bar it sits with the controls
// it clears (inside the panel); a bar without controls keeps it in the top row.

import { useId, useState, type ReactNode } from 'react';
import { FunnelSimpleIcon, XIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../Button/Button.atom';
import { InputAtom } from '../Input/Input.atom';
import styles from './FilterBar.module.css';

export interface FilterBarSearch {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
}

export interface FilterBarProps {
  search?: FilterBarSearch;
  /** Dimension controls. Each control carries its own accessible name. */
  children?: ReactNode;
  /** One-tap presets (toggle chips), shown with the controls. */
  quickFilters?: ReactNode;
  /** How many filters are set (search excluded): the N of „Filtry N”. */
  activeCount: number;
  onClear: () => void;
  /** What the list is narrowed to, in words. */
  summary?: ReactNode;
  labels: {
    /** Button that opens the controls on a narrow bar („Filtry”). */
    filters: string;
    /** „Wyczyść filtry”. */
    clear: string;
  };
  /** `flush` = no box of its own (the bar is a part of a box that has one). */
  surface?: 'box' | 'flush';
  className?: string;
}

export function FilterBarMolecule({
  search,
  children,
  quickFilters,
  activeCount,
  onClear,
  summary,
  labels,
  surface = 'box',
  className,
}: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const hasControls = children !== undefined || quickFilters !== undefined;
  const hasAnything = activeCount > 0 || (search?.value.length ?? 0) > 0;
  const renderClear = (placeClass: string | undefined) => (
    <ButtonAtom
      size='sm'
      variant='text'
      className={`${styles.clear}${placeClass ? ` ${placeClass}` : ''}`}
      icon={<XIcon size={14} weight='bold' />}
      disabled={!hasAnything}
      onClick={onClear}>
      {labels.clear}
    </ButtonAtom>
  );

  return (
    <div
      className={`${styles.bar}${className ? ` ${className}` : ''}`}
      data-surface={surface}
      data-panel={hasControls}>
      <div className={styles.top}>
        {search !== undefined && (
          <div className={styles.search}>
            <InputAtom
              type='search'
              value={search.value}
              placeholder={search.placeholder}
              aria-label={search.ariaLabel}
              onChange={event => search.onChange(event.target.value)}
              autoCapitalize='none'
              autoCorrect='off'
              spellCheck={false}
            />
          </div>
        )}
        {hasControls && (
          <ButtonAtom
            size='sm'
            variant='outlined'
            className={styles.toggle}
            icon={<FunnelSimpleIcon size={16} weight='bold' />}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen(value => !value)}>
            {activeCount > 0
              ? `${labels.filters} ${activeCount}`
              : labels.filters}
          </ButtonAtom>
        )}
        {renderClear(styles.clearTop)}
      </div>

      {hasControls && (
        <div id={panelId} className={styles.panel} data-open={open}>
          <div className={styles.panelInner}>
            {quickFilters !== undefined && (
              <div className={styles.quick}>{quickFilters}</div>
            )}
            {children !== undefined && (
              <div className={styles.controls}>{children}</div>
            )}
            {renderClear(styles.clearPanel)}
          </div>
        </div>
      )}

      {summary !== undefined && <p className={styles.summary}>{summary}</p>}
    </div>
  );
}
