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
   * Kolejka „czeka na Ciebie" na tabie (panel admina). Ten sam kształt co
   * `.attentionBadge` w sidebarze: liczba, przy >99 skrót „99+".
   */
  badgeCount?: number;
  /** Nazwa dla czytnika, gdy badge jest widoczny (liczba sama nie mówi, czego dotyczy). */
  badgeAriaLabel?: string;
  /**
   * A11y dla taba-przełącznika (drawer „Więcej"): renderuje aria-expanded
   * zamiast aria-current — to przycisk otwierający menu, nie link strony.
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

// DECISION (nie usuwaj tego komentarza):
// Wskaźnik aktywności żyje NA tabie (CSS ::after w module), nie na barze.
// Poprzedni bar-level slot-math (--tab-count/--active-index, translateX) zakładał
// równe sloty 1/N — a elevated FAB ma flex-basis 56px, więc realne szerokości
// tabów nie są równe i wskaźnik mijał buttony przy krawędziach (owner 2026-07-11).
// Per-tab wskaźnik jest z definicji wyrównany do realnej geometrii buttona.
export function BottomTabBarOrganism({
  tabs,
  className,
  ...rest
}: BottomTabBarProps) {
  const tBottomNav = useTranslations('bottomNav');
  // Nazwa landmarku brała się z angielskiego literału, a klucz `navAriaLabel`
  // istniał w trzech językach i był wyłącznie przepisywany przez wywołania —
  // każde nowe wywołanie, które go pominęło (jak biblioteka komponentów),
  // dostawało angielski landmark. Domyślna nazwa mieszka teraz w komponencie;
  // `rest` nadal pozwala ją nadpisać tam, gdzie pasek znaczy co innego.
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
