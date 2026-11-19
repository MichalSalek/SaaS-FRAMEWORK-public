import { useTranslations } from 'next-intl';
import type { IconWeight } from '@phosphor-icons/react';
import { type BottomTab } from '../components/BottomTabBar/BottomTabBar.organism';
import { markGlobalNavigation } from '../../application/routing/screen-arrival';
import { useViewTransitionRouter } from './useViewTransitionRouter';
import type { BottomTabConfigKeyed } from './appTabs.config';
import { isTabLit } from './useActiveTab';

interface UseAppTabsArgs {
  tabsConfig: ReadonlyArray<BottomTabConfigKeyed>;
  activePath: string;
  /** Opens the navigation drawer — owned by AppLayout (drawer state lives there). */
  onDrawerToggle: () => void;
  /** Drawer open = tab „Więcej" podświetlony (owner). */
  drawerOpen: boolean;
}

/**
 * Build the `BottomTab[]` consumed by `BottomTabBar` from the keyed config:
 * resolves i18n labels (bottomNav / admin namespaces), icon weight from active
 * state, and the per-tab click handler (drawer toggle vs view-transition nav).
 */
export function useAppTabs({
  tabsConfig,
  activePath,
  onDrawerToggle,
  drawerOpen,
}: UseAppTabsArgs): BottomTab[] {
  const navigate = useViewTransitionRouter();
  const tBottomNav = useTranslations('bottomNav');
  const tAdminLayout = useTranslations('layout.admin');

  return tabsConfig.map((tab, index) => {
    const IconComp = tab.icon;
    if (tab.placeholder === true || IconComp === undefined) {
      return {
        label: `placeholder-${String(index)}`,
        icon: null,
        placeholder: true,
      };
    }
    // An open drawer takes over the highlight, and a screen outside the tabs
    // lights „Więcej” (see the DECISION at `isTabLit` in useActiveTab.ts).
    const active = isTabLit(tab, activePath, drawerOpen);
    const weight: IconWeight = active ? 'fill' : 'regular';
    const label = tab.adminKey
      ? tAdminLayout(tab.adminKey)
      : tBottomNav(tab.bottomNavKey ?? 'dashboard');
    const onClick = () => {
      if (tab.isDrawerToggle) {
        onDrawerToggle();
        return;
      }
      if (tab.path) {
        // Przełączenie miejsca, nie krok w głąb (screen-arrival.ts).
        markGlobalNavigation();
        navigate(tab.path);
      }
    };
    const base: BottomTab = {
      label,
      icon: <IconComp size={22} weight={weight} />,
      active,
      onClick,
      // Toggle drawera = przycisk menu, nie link: aria-expanded zamiast
      // aria-current (organism rozróżnia po obecności pola).
      ...(tab.isDrawerToggle ? { ariaExpanded: drawerOpen } : {}),
    };
    return tab.elevated ? { ...base, elevated: true } : base;
  });
}
