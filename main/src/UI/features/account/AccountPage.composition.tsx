// UI/features/account/AccountPage.composition.tsx
// Entry of `/app/user/account` — account settings work like phone settings
// (owner 2026-10-08; canon: application/policies/account-sections.config.ts).
//
//  - Phone shell (below 1280px): the LIST of sections
//    (AccountSectionListPage.composition); a row opens its section on its own
//    route (AccountSectionPage.composition).
//  - Desktop (AccountWebLayout): the rail is the list (sub-items of „Konto”),
//    so this route shows the default section inline.
//  - An old `?tab=<value>` link is replaced with the matching section route.
//
// Stack: TQ v5 + CSS Modules + Phosphor Icons.

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import {
  DEFAULT_ACCOUNT_SECTION,
  buildAccountSectionHref,
  resolveLegacyAccountTab,
} from '../../../application/policies/account-sections.config';
import { runInstant } from '../../../application/routing/navigation.possibilities.api';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { AccountPageSkeletonMolecule } from './AccountPageStates.molecule';
import { AccountSectionListViewComposition } from './AccountSectionListPage.composition';
import { AccountSectionViewComposition } from './AccountSectionPage.composition';
import { useAccountShell } from './useAccountShell';

/**
 * Old links carry the section in `?tab=` (e-mails, bookmarks). They are
 * replaced ONCE with the section route: the target has no `tab` parameter, so
 * it cannot loop, and `runInstant` is the system-redirect seam (no leave-guard
 * prompt, no product motion). Returns true while the replace is in flight.
 * The page is static, so the query is readable only after `router.isReady`.
 */
function useLegacyTabRedirect(): boolean {
  const router = useRouter();
  const firedRef = useRef(false);
  const legacySection = router.isReady
    ? resolveLegacyAccountTab(router.query['tab'])
    : null;

  useEffect(() => {
    if (legacySection === null || firedRef.current) {
      return;
    }
    firedRef.current = true;
    const target = buildAccountSectionHref(legacySection);
    void runInstant(
      'account:legacy-tab-link',
      () => router.replace(target),
      target
    );
  }, [legacySection, router]);

  return legacySection !== null;
}

function AccountPageInner() {
  const shell = useAccountShell();
  const isRedirecting = useLegacyTabRedirect();

  if (isRedirecting) {
    return <AccountPageSkeletonMolecule shape='section' />;
  }
  if (shell === 'pending') {
    return <AccountPageSkeletonMolecule shape='list' />;
  }
  if (shell === 'rail') {
    return <AccountSectionViewComposition section={DEFAULT_ACCOUNT_SECTION} />;
  }
  return <AccountSectionListViewComposition />;
}

/* ─── Shell with AppLayout ─── */

export function AccountPageComposition() {
  const t = useTranslations('account.page');
  return (
    <AppLayoutComposition title={t('title')}>
      <AccountPageInner />
    </AppLayoutComposition>
  );
}
