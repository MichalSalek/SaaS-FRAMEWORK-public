// UI/layouts/AdminLayout.sidebarNav.organism.tsx
// The admin menu: every destination of SIDEBAR_SECTIONS in its group, drawn by
// the shared row primitive (the same component serves the desktop rail and
// the phone drawer). A destination with a counter carries it as the row's
// badge and, while something waits, leads straight to the counted list
// (features/admin/admin-attention.config.ts).

import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { SignOutIcon } from '@phosphor-icons/react';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../components/NavRow/NavRow.molecule';
import { ROUTES_FRONT_APP } from '@kernel/domain/routing/routing.config';
import type { AdminAttentionCounts } from '../features/admin/admin-attention.config';
import {
  isAdminPathActive,
  resolveNavAttention,
} from '../features/admin/navigation/adminNav.model';
import { SIDEBAR_SECTIONS } from './AdminLayout.sidebar.config';
import styles from './AdminLayout.module.css';

export function AdminSidebarNavOrganism({
  counts,
  onNavigate,
  onLogout,
}: {
  counts: AdminAttentionCounts | null;
  /** A destination was chosen (the phone drawer closes). */
  onNavigate: () => void;
  onLogout: () => void;
}) {
  const { pathname } = useRouter();
  const t = useTranslations('layout.admin');
  const tAttention = useTranslations('admin.attention');

  return (
    <>
      <nav className={styles.sidebarNav} aria-label={t('sidebarAriaLabel')}>
        {SIDEBAR_SECTIONS.map(section => (
          <NavRowListMolecule
            key={section.labelKey}
            label={t(section.labelKey)}
            density='compact'
            surface='nav'>
            {section.items.map(item => {
              const active = isAdminPathActive(
                pathname,
                item.path,
                ROUTES_FRONT_APP.ADMIN
              );
              const attention = resolveNavAttention(item, counts, tAttention);
              return (
                <NavRowMolecule
                  key={item.path}
                  href={attention.href}
                  icon={active ? item.iconActive : item.icon}
                  label={t(item.labelKey)}
                  active={active}
                  onClick={onNavigate}
                  // The number alone does not say what it counts: the badge
                  // is named with the sentence.
                  {...(attention.description !== null && {
                    badge: {
                      count: attention.count,
                      ariaLabel: attention.description,
                    },
                  })}
                />
              );
            })}
          </NavRowListMolecule>
        ))}
      </nav>
      {/* Sign-out: the admin shell once had no logout at all (the owner was
          stuck in it). Its own single-row group at the bottom of the menu. */}
      <div className={styles.sidebarFooter}>
        <NavRowListMolecule
          density='compact'
          surface='nav'
          ariaLabel={t('logout')}>
          <NavRowMolecule
            icon={<SignOutIcon size={18} weight='regular' />}
            label={t('logout')}
            onClick={onLogout}
          />
        </NavRowListMolecule>
      </div>
    </>
  );
}
