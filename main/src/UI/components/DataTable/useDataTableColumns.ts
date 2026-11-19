// UI/components/DataTable/useDataTableColumns.ts
// The person's column choice for one table, kept on this device per table id.
// Hydration-safe: the server and the hydration render use the definitions'
// defaults; the stored choice applies from the next render (external store,
// no hand-made `mounted` state).

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  deleteLocalStorage,
  getLocalStorage,
  setLocalStorage,
} from '../../../application/client-device-storage/local-storage-adapter/localStorage.adapter';
import { tableColumnsKey } from '../../../application/client-device-storage/storage-keys.config';
import {
  isSwitchableColumn,
  parseColumnOverrides,
  resolveVisibleColumnIds,
  toggleColumnOverride,
  type DataTableColumnVisibilitySpec,
} from './DataTable.columns';

const listeners = new Set<() => void>();

const subscribe = (onChange: () => void): (() => void) => {
  listeners.add(onChange);
  // Another tab changed the choice: follow it.
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
};

const notify = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

const getServerSnapshot = (): string | null => null;

export interface DataTableColumnsState {
  /** Ids of the columns to render. */
  visibleIds: ReadonlySet<string>;
  /** Is any column switchable at all (otherwise no control is shown). */
  hasSwitchable: boolean;
  setVisible: (columnId: string, visible: boolean) => void;
  /** Back to the definitions' defaults. */
  reset: () => void;
  /** The choice differs from the defaults. */
  isCustomized: boolean;
}

/**
 * `tableId` null = the table offers no choice: every non-switchable column and
 * the switchable ones at their defaults, nothing read from storage.
 */
export function useDataTableColumns(
  tableId: string | null,
  columns: readonly DataTableColumnVisibilitySpec[]
): DataTableColumnsState {
  const key = tableId === null ? null : tableColumnsKey(tableId);
  const raw = useSyncExternalStore(
    subscribe,
    () => (key === null ? null : getLocalStorage(key)),
    getServerSnapshot
  );
  const overrides = useMemo(() => parseColumnOverrides(raw), [raw]);
  const visibleIds = useMemo(
    () => resolveVisibleColumnIds(columns, overrides),
    [columns, overrides]
  );

  const setVisible = useCallback(
    (columnId: string, visible: boolean) => {
      if (key === null) {
        return;
      }
      const next = toggleColumnOverride(columns, overrides, columnId, visible);
      if (Object.keys(next).length === 0) {
        deleteLocalStorage(key);
      } else {
        setLocalStorage(key, JSON.stringify(next));
      }
      notify();
    },
    [columns, overrides, key]
  );

  const reset = useCallback(() => {
    if (key === null) {
      return;
    }
    deleteLocalStorage(key);
    notify();
  }, [key]);

  return {
    visibleIds,
    hasSwitchable: key !== null && columns.some(isSwitchableColumn),
    setVisible,
    reset,
    isCustomized: Object.keys(overrides).length > 0,
  };
}
