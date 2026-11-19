// UI/components/DataTable/DataTableColumnsMenu.molecule.tsx
// The „columns” control of a DataTable: the quiet button opening a menu with
// one on/off item per switchable column and „restore defaults” at the end.
// The menu stays open while the person switches several columns. The toolbar
// above the header row carries it next to the bulk-actions bar.

import type { ReactNode } from 'react';
import { ColumnsIcon } from '@phosphor-icons/react';
import { AppMenuAtom } from '../../primitives/AppMenu.atom';
import { buttonClassName, ButtonInner } from '../Button/buttonCore';
import {
  isSwitchableColumn,
  type DataTableColumnVisibilitySpec,
} from './DataTable.columns';
import type { DataTableColumnsState } from './useDataTableColumns';
import styles from './DataTable.module.css';

interface DataTableColumnsMenuProps {
  columns: readonly (DataTableColumnVisibilitySpec & { header: string })[];
  choice: DataTableColumnsState;
  label: string;
  resetLabel: string;
}

export function DataTableColumnsMenuMolecule({
  columns,
  choice,
  label,
  resetLabel,
}: DataTableColumnsMenuProps) {
  return (
    <AppMenuAtom>
      <AppMenuAtom.Trigger
        className={buttonClassName({
          variant: 'outlined',
          size: 'sm',
          isIconOnly: false,
        })}>
        <ButtonInner icon={<ColumnsIcon weight='bold' />}>{label}</ButtonInner>
      </AppMenuAtom.Trigger>
      <AppMenuAtom.Content align='end'>
        {columns.filter(isSwitchableColumn).map(column => (
          <AppMenuAtom.CheckboxItem
            key={column.id}
            checked={choice.visibleIds.has(column.id)}
            onCheckedChange={visible => choice.setVisible(column.id, visible)}>
            {column.header}
          </AppMenuAtom.CheckboxItem>
        ))}
        <AppMenuAtom.Separator />
        <AppMenuAtom.Item
          disabled={!choice.isCustomized}
          onClick={choice.reset}>
          {resetLabel}
        </AppMenuAtom.Item>
      </AppMenuAtom.Content>
    </AppMenuAtom>
  );
}

interface DataTableToolbarProps {
  /** Bulk actions for the checked rows (table layout only). */
  bar: ReactNode | undefined;
  /** Table-wide actions (export), standing before the columns menu. */
  actions: ReactNode | undefined;
  columnsMenu: DataTableColumnsMenuProps | undefined;
}

/** Above the header row: the bulk bar, then the actions and the columns menu at the end. */
export function DataTableToolbarMolecule({
  bar,
  actions,
  columnsMenu,
}: DataTableToolbarProps) {
  if (bar === undefined && actions === undefined && columnsMenu === undefined) {
    return null;
  }
  return (
    <div className={styles.toolbar}>
      {bar !== undefined && <div className={styles.selectionBar}>{bar}</div>}
      {(actions !== undefined || columnsMenu !== undefined) && (
        <div className={styles.columnsControl}>
          {actions}
          {columnsMenu !== undefined && (
            <DataTableColumnsMenuMolecule {...columnsMenu} />
          )}
        </div>
      )}
    </div>
  );
}
