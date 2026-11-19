import { describe, expect, it } from 'vitest';
import {
  isSwitchableColumn,
  parseColumnOverrides,
  resolveVisibleColumnIds,
  toggleColumnOverride,
  type DataTableColumnVisibilitySpec,
} from './DataTable.columns';

const COLUMNS: DataTableColumnVisibilitySpec[] = [
  // `optional` on a primary column is ignored: the row's name is never hidden.
  { id: 'name', priority: 'primary', optional: true },
  { id: 'email', priority: 'secondary', optional: true, defaultVisible: true },
  { id: 'status', priority: 'meta' },
  { id: 'photos', priority: 'meta', optional: true, defaultVisible: true },
  { id: 'city', priority: 'meta', optional: true },
];

const ids = (set: ReadonlySet<string>) => [...set];

describe('DataTable column visibility', () => {
  it('shows required columns and the optional ones that default on', () => {
    expect(ids(resolveVisibleColumnIds(COLUMNS, {}))).toEqual([
      'name',
      'email',
      'status',
      'photos',
    ]);
  });

  it('never lets the primary column be switched off', () => {
    expect(
      isSwitchableColumn(COLUMNS[0] ?? { id: 'x', priority: 'meta' })
    ).toBe(false);
    const overrides = toggleColumnOverride(COLUMNS, {}, 'name', false);
    expect(overrides).toEqual({});
    expect(
      resolveVisibleColumnIds(COLUMNS, { name: false, status: false }).has(
        'name'
      )
    ).toBe(true);
  });

  it('a stored choice overrides the defaults in both directions', () => {
    const visible = resolveVisibleColumnIds(COLUMNS, {
      email: false,
      city: true,
    });
    expect(ids(visible)).toEqual(['name', 'status', 'photos', 'city']);
  });

  it('a choice equal to the default is not stored', () => {
    const on = toggleColumnOverride(COLUMNS, {}, 'city', true);
    expect(on).toEqual({ city: true });
    expect(toggleColumnOverride(COLUMNS, on, 'city', false)).toEqual({});
    expect(toggleColumnOverride(COLUMNS, {}, 'photos', false)).toEqual({
      photos: false,
    });
  });

  it('round-trips through storage text and ignores anything malformed', () => {
    const stored = JSON.stringify(
      toggleColumnOverride(COLUMNS, {}, 'city', true)
    );
    expect(parseColumnOverrides(stored)).toEqual({ city: true });
    expect(parseColumnOverrides(null)).toEqual({});
    expect(parseColumnOverrides('not json')).toEqual({});
    expect(parseColumnOverrides('["city"]')).toEqual({});
    expect(parseColumnOverrides('{"city":"yes","email":false}')).toEqual({
      email: false,
    });
  });
});
