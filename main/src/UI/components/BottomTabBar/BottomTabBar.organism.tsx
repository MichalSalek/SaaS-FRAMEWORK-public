import type { ReactNode, HTMLAttributes } from 'react';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import styles from './BottomTabBar.module.css';

export interface BottomTab {
  label: string;
  icon: ReactNode;
  active?: boolean;
  onClick?: () => void;
  /** Render as elevated FAB-center (raised circle, accent bg, icon-only). */
  elevated?: boolean;
  /**
   * The „waiting for you" queue on a tab (admin panel). The same shape as `.attentionBadge` in
   * the sidebar: a number, shortened to „99+" above 99.
   */
  badgeCount?: number;
  /** Name for the screen reader when the badge is visible (the number alone does not say what it counts). */
  badgeAriaLabel?: string;
  /**
   * A11y for a toggle tab (the „Więcej" drawer): renders aria-expanded instead of aria-current,
   * because it is a button that opens a menu, not a page link.
   */
  ariaExpanded?: boolean;
  /**
   * An inert slot with no destination: it only keeps the bar's geometry while
   * the tabs of the active role are not known yet. `label` is its React key.
   */
  placeholder?: boolean;
}

export interface BottomTabBarProps extends HTMLAttributes<HTMLElement> {
  tabs: BottomTab[];
  className?: string;
}

// DECISION: the active selection lives ON the tab (CSS ::before in the module), not on the bar. A
// bar-level slot math (--tab-count/--active-index, translateX) assumed equal 1/N slots, but the
// elevated FAB has a fixed width, so real tab widths differ and the indicator missed the buttons
// near the edges.
export function BottomTabBarOrganism({
  tabs,
  className,
  ...rest
}: BottomTabBarProps) {
  const tBottomNav = useTranslations('bottomNav');
  // The landmark name used to come from an English literal while the `navAriaLabel` key existed in
  // three languages and was only copied by callers; a call that skipped it (like the component
  // library) got an English landmark. The default name now lives in the component; `rest` still
  // lets a caller override it where the bar means something else.
  return (
    <nav
      className={clsx(styles.tabBar, className)}
      aria-label={tBottomNav('navAriaLabel')}
      {...rest}>
      {tabs.map(tab =>
        tab.placeholder === true ? (
          <span
            key={tab.label}
            className={styles.placeholder}
            aria-hidden='true'>
            <span className={styles.placeholderMark} />
          </span>
        ) : (
          <button
            key={tab.label}
            type='button'
            className={clsx(styles.tab, { [styles.active ?? '']: tab.active })}
            onClick={tab.onClick}
            data-elevated={tab.elevated ? 'true' : undefined}
            aria-expanded={tab.ariaExpanded}
            aria-current={
              tab.active && tab.ariaExpanded === undefined ? 'page' : undefined
            }>
            <span className={styles.icon}>
              {tab.icon}
              {tab.badgeCount !== undefined && tab.badgeCount > 0 && (
                <span
                  className={styles.attentionBadge}
                  aria-label={tab.badgeAriaLabel}>
                  {tab.badgeCount > 99 ? '99+' : tab.badgeCount}
                </span>
              )}
            </span>
            <span className={styles.label}>{tab.label}</span>
          </button>
        )
      )}
    </nav>
  );
}
