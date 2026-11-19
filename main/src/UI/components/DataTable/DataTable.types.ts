// UI/components/DataTable/DataTable.types.ts
// The public contract of DataTableOrganism (re-exported from the organism).

import type { ReactNode } from 'react';

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
  /** The person may switch this column off (needs the table's
   *  `columnVisibility`). Never applies to a `primary` column. */
  optional?: boolean;
  /** For an `optional` column: shown until switched off. Default: hidden. */
  defaultVisible?: boolean;
}

/** The person chooses the `optional` columns; kept per `tableId` on the device. */
export interface DataTableColumnVisibility {
  /** Stable id of the table (storage key); never reuse it for another table. */
  tableId: string;
  /** Trigger of the menu („Kolumny”). */
  label: string;
  /** Menu item that restores the defaults. */
  resetLabel: string;
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
  columnVisibility?: DataTableColumnVisibility;
  /** Table-wide actions above the header row, before the columns menu (export). */
  toolbarActions?: ReactNode;
  skeletonRows?: number;
  density?: 'regular' | 'compact';
  /** `flush` = no box of its own (the table is a part of a box that has one). */
  surface?: 'box' | 'flush';
  /** Under the last row, inside the box (pagination, „showing N of M”). */
  footer?: ReactNode;
  className?: string;
}
