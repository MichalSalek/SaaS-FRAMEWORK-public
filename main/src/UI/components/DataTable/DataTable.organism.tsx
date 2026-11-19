// DataTable: the one table of list pages. A column says what it shows AND how much it matters (`priority`);
// from that single description the table renders a real table from 768px of its OWN width (header
// row, aligned columns), and below it one stacked card per row: `primary` cells as the title line,
// `secondary` as body lines, `meta` cells together on one quiet line. Loading keeps the geometry
// (skeleton rows); an empty list and a failed read are separate states (a failed read never
// looks like „no data”).
// DECISION: ONE responsive behaviour lives here, driven by `priority`; six admin tables had turned
// into six different phone layouts. The markup is divs with EXPLICIT ARIA table roles: the card
// layout changes `display`, and browsers drop the implicit table semantics of <table>/<tr> when
// their display changes. The width switch is a container query, because admin routes also render
// inside a 390px frame on a wide desktop, where a viewport query lies.
// Sorting and row checkboxes (bulk actions) exist ONLY in the table layout, where a header row
// exists; a page with bulk actions hides them below the same width. Columns marked `optional` get
// a switch in the „columns” menu (`columnVisibility`), kept on the device per table id; a hidden
// column is gone from both layouts, and the wide table scrolls sideways instead of squeezing.

import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import { CaretDownIcon, CaretUpIcon } from '@phosphor-icons/react';
import { AppLinkAtom } from '../AppLink/AppLink.atom';
import { CheckboxAtom } from '../Checkbox/Checkbox.atom';
import { ErrorStateMolecule } from '../ErrorState/ErrorState.molecule';
import { SkeletonAtom } from '../Skeleton/Skeleton.atom';
import { tableMinInline } from './DataTable.columns';
import { DataTableToolbarMolecule } from './DataTableColumnsMenu.molecule';
import { useDataTableColumns } from './useDataTableColumns';
import type {
  DataTableColumn,
  DataTablePriority,
  DataTableProps,
} from './DataTable.types';
import styles from './DataTable.module.css';

export type {
  DataTableColumn,
  DataTableError,
  DataTableProps,
} from './DataTable.types';

const DEFAULT_TRACK = 'minmax(0, 1fr)';
const SELECT_TRACK = '44px';
const SKELETON_WIDTH: Record<DataTablePriority, string> = {
  primary: '72%',
  secondary: '56%',
  meta: '40%',
};

export function DataTableOrganism<T>({
  columns: allColumns,
  rows,
  rowKey,
  caption,
  onRowClick,
  rowHref,
  rowLabel,
  state,
  empty,
  error,
  selectedKey = null,
  sort,
  selection,
  columnVisibility,
  toolbarActions,
  skeletonRows = 6,
  density = 'regular',
  surface = 'box',
  footer,
  className,
}: DataTableProps<T>) {
  const columnChoice = useDataTableColumns(
    columnVisibility?.tableId ?? null,
    allColumns
  );
  const columns = allColumns.filter(column =>
    columnChoice.visibleIds.has(column.id)
  );
  const showColumnsMenu =
    columnVisibility !== undefined && columnChoice.hasSwitchable;
  const tracks = [
    ...(selection !== undefined ? [SELECT_TRACK] : []),
    ...columns.map(column => column.width ?? DEFAULT_TRACK),
  ].join(' ');
  const linkColumnId =
    rowHref === undefined
      ? null
      : (columns.find(column => column.priority === 'primary')?.id ?? null);
  const isBusy = state === 'loading';

  const cellClass = (column: DataTableColumn<T>) =>
    `${styles.cell}${column.align === 'end' ? ` ${styles.alignEnd}` : ''}`;

  const activate = (row: T) => (event: KeyboardEvent<HTMLDivElement>) => {
    // Only the row itself: a key pressed on a control inside a cell is that
    // control's business.
    if (event.target !== event.currentTarget || onRowClick === undefined) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRowClick(row);
    }
  };

  return (
    <div
      className={`${styles.wrap}${className ? ` ${className}` : ''}`}
      data-surface={surface}
      data-density={density}>
      {state === 'error' && error !== undefined ? (
        <ErrorStateMolecule {...error} />
      ) : state === 'empty' ? (
        <div className={styles.empty} role='status'>
          {empty}
        </div>
      ) : (
        <>
          <DataTableToolbarMolecule
            bar={selection?.bar}
            actions={toolbarActions}
            columnsMenu={
              showColumnsMenu
                ? {
                    ...columnVisibility,
                    columns: allColumns,
                    choice: columnChoice,
                  }
                : undefined
            }
          />
          <div
            role='table'
            aria-label={caption}
            aria-busy={isBusy}
            aria-rowcount={isBusy ? undefined : rows.length + 1}
            className={styles.table}
            data-scroll={showColumnsMenu || undefined}
            style={
              {
                '--dt-tracks': tracks,
                '--dt-min-inline': tableMinInline(tracks),
              } as CSSProperties
            }>
            <div role='rowgroup' className={styles.head}>
              <div role='row' className={styles.headRow}>
                {selection !== undefined && (
                  <div role='columnheader' className={styles.selectCell}>
                    <CheckboxAtom
                      checked={selection.allSelected}
                      onChange={selection.onToggleAll}
                      aria-label={selection.allLabel}
                    />
                  </div>
                )}
                {columns.map(column => {
                  const sortActive = sort?.columnId === column.id;
                  return (
                    <div
                      key={column.id}
                      role='columnheader'
                      className={`${styles.headCell}${column.align === 'end' ? ` ${styles.alignEnd}` : ''}`}
                      {...(sort !== undefined &&
                        column.sortable === true && {
                          'aria-sort': !sortActive
                            ? ('none' as const)
                            : sort.direction === 'asc'
                              ? ('ascending' as const)
                              : ('descending' as const),
                        })}>
                      {sort !== undefined && column.sortable === true ? (
                        <button
                          type='button'
                          className={styles.sortButton}
                          data-active={sortActive}
                          onClick={() => sort.onSort(column.id)}>
                          {column.header}
                          {/* Always in the box, so a sort change moves nothing. */}
                          <span className={styles.sortGlyph} aria-hidden='true'>
                            {sortActive && sort.direction === 'asc' ? (
                              <CaretUpIcon size={12} weight='bold' />
                            ) : (
                              <CaretDownIcon size={12} weight='bold' />
                            )}
                          </span>
                        </button>
                      ) : (
                        column.header
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div role='rowgroup' className={styles.body}>
              {isBusy
                ? Array.from({ length: skeletonRows }, (_, index) => (
                    <div key={index} className={styles.row} aria-hidden='true'>
                      {selection !== undefined && (
                        <div className={styles.selectCell} />
                      )}
                      {columns.map(column => (
                        <div
                          key={column.id}
                          className={cellClass(column)}
                          data-priority={column.priority}>
                          <SkeletonAtom
                            variant='text'
                            width={SKELETON_WIDTH[column.priority]}
                            height={16}
                          />
                        </div>
                      ))}
                    </div>
                  ))
                : rows.map(row => {
                    const key = rowKey(row);
                    const isSelected = selectedKey === key;
                    return (
                      <div
                        key={key}
                        role='row'
                        className={styles.row}
                        data-interactive={
                          onRowClick !== undefined || rowHref !== undefined
                        }
                        data-selected={isSelected}
                        aria-selected={
                          selectedKey === null ? undefined : isSelected
                        }
                        {...(onRowClick !== undefined && {
                          tabIndex: 0,
                          // The checkbox is its own target: it never opens the row.
                          onClick: (event: MouseEvent<HTMLDivElement>) => {
                            if (!(
                              event.target instanceof Element &&
                              event.target.closest('[data-row-stop]') !== null
                            )) {
                              onRowClick(row);
                            }
                          },
                          onKeyDown: activate(row),
                          ...(rowLabel !== undefined && {
                            'aria-label': rowLabel(row),
                          }),
                        })}>
                        {selection !== undefined && (
                          <div
                            role='cell'
                            className={styles.selectCell}
                            data-row-stop=''>
                            <CheckboxAtom
                              checked={selection.isSelected(row)}
                              onChange={() => selection.onToggle(row)}
                              aria-label={selection.rowLabel(row)}
                            />
                          </div>
                        )}
                        {columns.map(column => (
                          <div
                            key={column.id}
                            role='cell'
                            className={cellClass(column)}
                            data-priority={column.priority}
                            {...(column.action === true && {
                              'data-action': 'true',
                            })}>
                            {column.labelInCard === true && (
                              <span
                                className={styles.cardLabel}
                                aria-hidden='true'>
                                {column.header}
                              </span>
                            )}
                            {rowHref !== undefined &&
                            column.id === linkColumnId ? (
                              <AppLinkAtom
                                href={rowHref(row)}
                                className={styles.rowLink}
                                {...(rowLabel !== undefined && {
                                  'aria-label': rowLabel(row),
                                })}>
                                {column.cell(row)}
                              </AppLinkAtom>
                            ) : (
                              column.cell(row)
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })}
            </div>
          </div>
        </>
      )}
      {footer !== undefined && state !== 'error' && (
        <div className={styles.footer}>{footer}</div>
      )}
    </div>
  );
}
