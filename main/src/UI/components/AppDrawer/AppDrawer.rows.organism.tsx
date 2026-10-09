import { HouseIcon } from '@phosphor-icons/react';
import { NavRowListMolecule, NavRowMolecule } from '../NavRow/NavRow.molecule';
import type { DrawerSection } from './appDrawerSections';
import styles from './AppDrawer.module.css';

type DrawerItem = DrawerSection['items'][number];

interface AppDrawerRowsProps {
  sections: DrawerSection[];
  /** Label of the „Twój panel” row, or null when this role has none. */
  dashboardLabel: string | null;
  pathname: string;
  /** The organism's handleNavigate: closes the drawer, then navigates, so the
   *  exit transition and the focus-trap release stay in one place. */
  onNavigate: (path: string) => void;
  badgeAriaLabel: string;
}

const DASHBOARD_PATH = '/app';

/**
 * The drawer's menu: every section is one group of the shared NavRow
 * primitive (DECISION in AppDrawer.organism).
 */
export function AppDrawerRowsOrganism({
  sections,
  dashboardLabel,
  pathname,
  onNavigate,
  badgeAriaLabel,
}: AppDrawerRowsProps) {
  const renderItem = (item: DrawerItem) => (
    <NavRowMolecule
      key={item.label}
      icon={item.icon}
      label={item.label}
      tone={item.danger ? 'danger' : 'default'}
      active={item.path !== undefined && pathname === item.path}
      trailing={item.path !== undefined ? 'chevron' : 'none'}
      onClick={() => {
        if (item.action) {
          item.action();
        } else if (item.path) {
          onNavigate(item.path);
        }
      }}
      {...(item.badgeCount !== undefined && item.badgeCount > 0
        ? { badge: { count: item.badgeCount, ariaLabel: badgeAriaLabel } }
        : {})}
    />
  );

  return (
    <div className={styles.rows}>
      {dashboardLabel !== null && (
        <NavRowListMolecule ariaLabel={dashboardLabel}>
          <NavRowMolecule
            icon={<HouseIcon size={18} />}
            label={dashboardLabel}
            active={pathname === DASHBOARD_PATH}
            trailing='chevron'
            onClick={() => onNavigate(DASHBOARD_PATH)}
          />
        </NavRowListMolecule>
      )}

      {sections.map((section, index) => {
        // A danger row never shares a box with ordinary rows: it gets its own
        // single-row group right after them.
        const regular = section.items.filter(item => !item.danger);
        const danger = section.items.filter(item => item.danger);
        const key = section.label ?? `s-${String(index)}`;
        return [
          regular.length > 0 && (
            <NavRowListMolecule
              key={key}
              {...(section.label ? { label: section.label } : {})}>
              {regular.map(renderItem)}
            </NavRowListMolecule>
          ),
          danger.length > 0 && (
            <NavRowListMolecule key={`${key}-danger`}>
              {danger.map(renderItem)}
            </NavRowListMolecule>
          ),
        ];
      })}
    </div>
  );
}
