// UI/components/DataTable/DataTable.columns.ts
// Which columns a table shows, as a pure model: the table's definitions say
// which columns may be switched off (`optional`) and which start on
// (`defaultVisible`); the person's choice is stored per table as overrides of
// those defaults. A column the definitions do not mark optional is always shown.

/** What the column-visibility model needs from a column definition. */
export interface DataTableColumnVisibilitySpec {
  id: string;
  priority: 'primary' | 'secondary' | 'meta';
  optional?: boolean;
  defaultVisible?: boolean;
}

/** The person's choice: column id → shown. Only switchable columns count. */
export type DataTableColumnOverrides = Readonly<Record<string, boolean>>;

/**
 * A column the person may switch off. The primary column names the row (the
 * person, the record) and is never switchable, whatever the definition says.
 */
export const isSwitchableColumn = (
  column: DataTableColumnVisibilitySpec
): boolean => column.optional === true && column.priority !== 'primary';

/**
 * Stored text → overrides. Anything that is not an object of booleans is
 * ignored as a whole (an old or hand-edited value never breaks the table).
 */
export const parseColumnOverrides = (
  raw: string | null
): DataTableColumnOverrides => {
  if (raw === null || raw.length === 0) {
    return {};
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return {};
    }
    const overrides: Record<string, boolean> = {};
    for (const [key, flag] of Object.entries(value)) {
      if (typeof flag === 'boolean') {
        overrides[key] = flag;
      }
    }
    return overrides;
  } catch {
    return {};
  }
};

/** Ids of the columns to show, in definition order. */
export const resolveVisibleColumnIds = (
  columns: readonly DataTableColumnVisibilitySpec[],
  overrides: DataTableColumnOverrides
): ReadonlySet<string> =>
  new Set(
    columns
      .filter(column =>
        isSwitchableColumn(column)
          ? (overrides[column.id] ?? column.defaultVisible === true)
          : true
      )
      .map(column => column.id)
  );

/**
 * Overrides after one switch. A choice equal to the column's default is
 * dropped rather than stored, so a later change of the default reaches people
 * who never touched that column.
 */
export const toggleColumnOverride = (
  columns: readonly DataTableColumnVisibilitySpec[],
  overrides: DataTableColumnOverrides,
  columnId: string,
  visible: boolean
): DataTableColumnOverrides => {
  const column = columns.find(candidate => candidate.id === columnId);
  if (column === undefined || !isSwitchableColumn(column)) {
    return overrides;
  }
  const next: Record<string, boolean> = { ...overrides };
  if (visible === (column.defaultVisible === true)) {
    delete next[columnId];
  } else {
    next[columnId] = visible;
  }
  return next;
};

// Narrowest width a flexible track (`minmax(0, Nfr)`) may take before a table
// with chosen columns scrolls sideways instead of squeezing it further.
const FLEX_TRACK_MIN = '12rem';
const COLUMN_GAP = 'var(--space-16)';

/**
 * The least width of a row for a grid track list: fixed tracks (`px`, `rem`)
 * as given, every other track at FLEX_TRACK_MIN, plus the column gaps.
 */
export const tableMinInline = (tracks: string): string => {
  const parts = tracks
    .split(/ (?![^(]*\))/)
    .map(track =>
      /^\d+(\.\d+)?(px|rem)$/.test(track) ? track : FLEX_TRACK_MIN
    );
  const gaps = Math.max(0, parts.length - 1);
  return `calc(${parts.join(' + ')} + ${gaps} * ${COLUMN_GAP})`;
};
