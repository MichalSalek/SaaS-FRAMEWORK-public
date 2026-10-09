// UI/components/DataTable/DataTable.organism.tsx
// The one table of list pages. A column says what it shows AND how much it
// matters (`priority`); from that single description the table renders:
//  • from 768px of its OWN width: a real table (header row, aligned columns);
//  • below: one stacked card per row — `primary` cells as the title line,
//    `secondary` as body lines, `meta` cells together on one quiet line.
// Loading keeps the geometry (skeleton rows), an empty list and a failed read
// are separate states (a failed read never looks like „no data”).
//
// DECISION (nie usuwaj tego komentarza) — S126 census: six admin tables turned
// into six different phone layouts (8-line key/value stacks at 1,5 rows per
// screen, a real table cut at the right edge, truncated cells that hid which
// row was which). ONE responsive behaviour lives here, driven by `priority`.
// The markup is divs with EXPLICIT ARIA table roles: the card layout changes
// `display`, and browsers drop the implicit table semantics of <table>/<tr>
// when their display changes; explicit roles survive it. The width switch is
// a container query, because admin routes also render inside a 390px frame on
// a wide desktop, where a viewport query lies.
//
// Two things exist ONLY in the table layout (from 768px), because that is
// where a header row exists: sorting (`sort` + a column's `sortable`) and row
// checkboxes (`selection`, for bulk actions). A page that offers bulk actions
// hides them below the same width.

import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
} from 'react';
import { CaretDownIcon, CaretUpIcon } from '@phosphor-icons/react';
import { AppLinkAtom } from '../AppLink/AppLink.atom';
import { CheckboxAtom } from '../Checkbox/Checkbox.atom';
import { ErrorStateMolecule } from '../ErrorState/ErrorState.molecule';
import { SkeletonAtom } from '../Skeleton/Skeleton.atom';
import styles from './DataTable.module.css';

export type DataTablePriority = 'primary' | 'secondary' | 'meta';

export interface DataTableColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'start' | 'end';
  /** Role of the column in the stacked card (and its weight in the table). */
  priority: DataTablePriority;
  /** Track size in the table layout (any grid track; default `minmax(0, 1fr)`). */
  width?: string;
  /** Stacked card: print the header before the value („Wystąpienia 12”). */
  labelInCard?: boolean;
  /** The row's menu or single icon action. In the card layout the cell stands
   *  in the card's top-right corner; in the table it is an ordinary column. */
  action?: boolean;
  /** The header is a sort button (needs the table's `sort`). */
  sortable?: boolean;
}

/** Server-side sort: the table only shows it and asks for a change. */
export interface DataTableSort {
  columnId: string;
  direction: 'asc' | 'desc';
  onSort: (columnId: string) => void;
}

/** Row checkboxes (bulk actions); shown in the table layout only. */
export interface DataTableSelection<T> {
  isSelected: (row: T) => boolean;
  onToggle: (row: T) => void;
  allSelected: boolean;
  onToggleAll: () => void;
  rowLabel: (row: T) => string;
  allLabel: string;
  /** Bulk actions for the checked rows; stands above the header row. */
  bar?: ReactNode;
}

export interface DataTableError {
  message: string;
  retryLabel: string;
  onRetry: () => void;
  isRetrying: boolean;
}

export interface DataTableProps<T> {
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** Accessible name of the table. */
  caption: string;
  /** Whole row acts (opens the record). Give `rowLabel` with it. */
  onRowClick?: (row: T) => void;
  /** Whole row is a link (the first primary cell carries the anchor). */
  rowHref?: (row: T) => string;
  /** Accessible name of the row action / link. */
  rowLabel?: (row: T) => string;
  state: 'ready' | 'loading' | 'empty' | 'error';
  /** Shown for `state='empty'`. */
  empty: ReactNode;
  /** Required for `state='error'`. */
  error?: DataTableError;
  /** Key of the row shown elsewhere (master and detail): inverted ink. */
  selectedKey?: string | null;
  sort?: DataTableSort;
  selection?: DataTableSelection<T>;
  skeletonRows?: number;
  density?: 'regular' | 'compact';
  /** `flush` = no box of its own (the table is a part of a box that has one). */
  surface?: 'box' | 'flush';
  /** Under the last row, inside the box (pagination, „showing N of M”). */
  footer?: ReactNode;
  className?: string;
}

const DEFAULT_TRACK = 'minmax(0, 1fr)';
const SELECT_TRACK = '44px';
const SKELETON_WIDTH: Record<DataTablePriority, string> = {
  primary: '72%',
  secondary: '56%',
  meta: '40%',
};

export function DataTableOrganism<T>({
  columns,
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
  skeletonRows = 6,
  density = 'regular',
  surface = 'box',
  footer,
  className,
}: DataTableProps<T>) {
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
          {selection?.bar !== undefined && (
            <div className={styles.selectionBar}>{selection.bar}</div>
          )}
          <div
            role='table'
            aria-label={caption}
            aria-busy={isBusy}
            aria-rowcount={isBusy ? undefined : rows.length + 1}
            className={styles.table}
            style={{ '--dt-tracks': tracks } as CSSProperties}>
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
