// UI/layouts/AccountWebLayout.composition.tsx
//
// Desktop (>=1280) account chrome — analog do AdminLayout+AdminPageLayout, ale
// dla tras KONTA non-admin (account / plan / billing / support). Zastępuje
// dawną „mobilna treść wciśnięta w phone-frame / lite-dashboard column" pełnym
// web-shellem: ciemny lewy nav-rail (tożsamość + nawigacja konta + „produkt w
// telefonie") + wyśrodkowana kolumna treści.
//
// DECISION (nie usuwaj tego komentarza):
// AccountWebLayout renderuje się TYLKO na desktopie >=1280 (AppLayout wybiera go
// dla account-routes zamiast phone-frame / dawnego lite-dashboardu). Mobile / tablet
// (<1280) NIGDY tu nie trafia — używa zwykłego AppLayout shella (AppBar +
// BottomTabBar). Dlatego ten komponent jest bezwarunkowo desktopowy: brak
// hamburgera, mobile-overlay ani bottom-nav (byłyby martwym kodem). Treść strony
// (jej własne <AppHero>/hero) renderuje się w .content i pełni rolę header-banda
// — layout dostarcza tylko chrome (rail), nie własny tytuł strony.
//
// Editorial flat: ciemny rail (--color-nav-bg), hairline bordery, gold accent,
// zero cieni/gradientów (anti-slop floor).

import { Fragment, type ReactNode } from 'react';
import { AppLinkAtom as Link } from '../components/AppLink/AppLink.atom';
import { useRouter } from 'next/router';
import {
  getStoreUrl,
  hasAnyStoreUrl,
} from '@kernel/domain/platform/platform.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  AndroidLogoIcon,
  ArrowUpRightIcon,
  SignOutIcon,
} from '@phosphor-icons/react';
import { useAuth } from '../contexts/AuthContext.composition';
import { AvatarAtom } from '../components/Avatar/Avatar.atom';
import { BrandLockupMolecule } from '../components/BrandLockup/BrandLockup.molecule';
import { LinkButtonAtom } from '../components/Button/LinkButton.atom';
import {
  resolveActiveAccountSection,
  type AccountSectionLabelKey,
} from '../../application/policies/account-sections.config';
import {
  ACCOUNT_WEB_NAV,
  type AccountWebNavItem,
} from './AccountWebLayout.sidebar.config';
import { NavigationContentShellComposition } from './NavigationContentShell.composition';
import { EyebrowAtom } from '../components/Eyebrow/Eyebrow.atom';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../components/NavRow/NavRow.molecule';
import styles from './AccountWebLayout.module.css';

/** Narrow identity slice fed from AppLayout's single currentUser read. */
export interface AccountWebIdentity {
  /** Display name (stylist display_name → user name → email local part). */
  name: string;
  /** Avatar image URL, if any. */
  avatarUrl?: string | undefined;
  /** Human plan label (e.g. "Plan Pro"); undefined for accounts without a plan. */
  planLabel?: string | undefined;
}

export interface AccountWebLayoutTranslations extends Record<
  AccountSectionLabelKey,
  string
> {
  /** Rail eyebrow over the identity block, e.g. "Twoje konto". */
  eyebrow: string;
  /** aria-label for the rail <nav>. */
  navAriaLabel: string;
  navHome: string;
  navProfile: string;
  navAccount: string;
  navBilling: string;
  navSupport: string;
  /** aria-label of the list of account settings sections under „Konto”. */
  sectionsAriaLabel: string;
  /** Footer heading, e.g. "Produkt masz w telefonie". */
  productTitle: string;
  /** Active Android CTA label. */
  androidLabel: string;
  androidAriaLabel: string;
  /** Disabled placeholder when the app is not published yet. */
  androidComingSoon: string;
  /** Sign-out action label. */
  logout: string;
  /** Skip-to-content link. */
  skipToContent: string;
}

interface AccountWebLayoutProps {
  children: ReactNode;
  identity: AccountWebIdentity | null;
  // Poza trybem stylistki nie ma ani subskrypcji, ani publicznej wizytówki —
  // obie pozycje prowadziłyby w ślepy zaułek (403 / pusty ekran). SSOT decyzji:
  // application/policies/account-surface.policy.ts.
  showBilling: boolean;
  showProfile: boolean;
  tx: AccountWebLayoutTranslations;
}

const NAV_LABEL: Record<
  (typeof ACCOUNT_WEB_NAV)[number]['labelKey'],
  keyof AccountWebLayoutTranslations
> = {
  navHome: 'navHome',
  navProfile: 'navProfile',
  navAccount: 'navAccount',
  navBilling: 'navBilling',
  navSupport: 'navSupport',
};

/**
 * Active when the pathname exactly matches the item OR sits under it (`path/…`),
 * UNLESS a more specific nav item (longer path) also matches — so `/account/pay`
 * highlights "Płatności", not "Konto" (whose path is a prefix of pay's).
 */
function isNavActive(pathname: string, path: string): boolean {
  const matches = (p: string): boolean =>
    pathname === p || pathname.startsWith(p + '/');
  if (!matches(path)) {
    return false;
  }
  return !ACCOUNT_WEB_NAV.some(
    other => other.path.length > path.length && matches(other.path)
  );
}

export function AccountWebLayoutComposition({
  children,
  identity,
  showBilling,
  showProfile,
  tx,
}: AccountWebLayoutProps) {
  const router = useRouter();
  const { logout } = useAuth();
  const androidUrl = getStoreUrl('android');
  const androidLive = hasAnyStoreUrl() && androidUrl !== '';
  // Account settings sections live under „Konto” (owner 2026-10-08: the menu
  // has ONE fixed place). The open section carries the selection, so „Konto”
  // itself is not marked while one of its sections is.
  const activeSection = resolveActiveAccountSection(
    router.pathname,
    router.query['section']
  );
  const isItemActive = (item: AccountWebNavItem): boolean =>
    isNavActive(router.pathname, item.path) &&
    !(item.children !== undefined && activeSection !== null);
  const isItemOpen = (item: AccountWebNavItem): boolean =>
    isNavActive(router.pathname, item.path);
  // The sections of „Konto” are compact sub-rows of the same primitive.
  const renderSections = (item: AccountWebNavItem): ReactNode =>
    item.children !== undefined && (
      <li className={styles.navSections}>
        <NavRowListMolecule
          density='compact'
          surface='nav'
          ariaLabel={tx.sectionsAriaLabel}>
          {item.children.map(child => (
            <NavRowMolecule
              key={child.id}
              href={child.path}
              label={tx[child.labelKey]}
              active={activeSection === child.id}
              tone={child.tone}
            />
          ))}
        </NavRowListMolecule>
      </li>
    );
  const navItems = ACCOUNT_WEB_NAV.filter(item => {
    if (item.labelKey === 'navBilling') {
      return showBilling;
    }
    if (item.labelKey === 'navProfile') {
      return showProfile;
    }
    return true;
  });

  return (
    <div className={styles.layout}>
      <a href='#main-content' className={styles.skipLink}>
        {tx.skipToContent}
      </a>

      <aside className={styles.rail}>
        <div className={styles.railTop}>
          <Link href={ROUTES_FRONT.HOME} className={styles.brand}>
            <BrandLockupMolecule markClassName={styles.brandMark} />
          </Link>

          <div className={styles.identity}>
            <AvatarAtom
              src={identity?.avatarUrl}
              name={identity?.name ?? 'U'}
              size='md'
            />
            <div className={styles.identityText}>
              <EyebrowAtom as='p' variant='plain'>
                {tx.eyebrow}
              </EyebrowAtom>
              <p className={styles.identityName}>{identity?.name ?? ''}</p>
              {identity?.planLabel !== undefined &&
                identity.planLabel.length > 0 && (
                  <p className={styles.identityPlan}>{identity.planLabel}</p>
                )}
            </div>
          </div>

          <button type='button' className={styles.logoutBtn} onClick={logout}>
            <SignOutIcon size={18} weight='regular' aria-hidden='true' />
            <span>{tx.logout}</span>
          </button>
        </div>

        <nav className={styles.nav} aria-label={tx.navAriaLabel}>
          {/* DECISION (nie usuwaj tego komentarza) — głos ownera
              `s126-wiersze`, 2026-10-09: szyna to jedna grupa wspólnego
              wiersza (NavRow, biały boks z komórkami), sekcje „Konta” to
              zwarte pod-wiersze tego samego prymitywu. Własne pozycje szyny
              (`.navItem`) zostały usunięte; nie przywracać. */}
          <NavRowListMolecule density='comfortable' surface='nav'>
            {navItems.map(item => (
              <Fragment key={item.path}>
                <NavRowMolecule
                  href={item.path}
                  icon={isItemOpen(item) ? item.iconActive : item.icon}
                  label={tx[NAV_LABEL[item.labelKey]]}
                  active={isItemActive(item)}
                  trailing='chevron'
                />
                {renderSections(item)}
              </Fragment>
            ))}
          </NavRowListMolecule>
        </nav>

        <div className={styles.railFooter}>
          <Link href={ROUTES_FRONT.GET_APP} className={styles.footerTitle}>
            <span>{tx.productTitle}</span>
            <ArrowUpRightIcon size={13} weight='bold' aria-hidden='true' />
          </Link>
          {androidLive ? (
            <LinkButtonAtom
              href={androidUrl}
              external
              variant='primary'
              size='md'
              className={styles.androidBtn}
              icon={<AndroidLogoIcon size={18} weight='regular' />}
              ariaLabel={tx.androidAriaLabel}>
              {tx.androidLabel}
            </LinkButtonAtom>
          ) : (
            <p className={styles.androidNote}>{tx.androidComingSoon}</p>
          )}
        </div>
      </aside>

      {/* id=main-content + overflow scroll: odtwarza scroll-container AppLayout
       * (AppHero.closest('#main-content') dla observera; view-timeline reveal na
       * support-detail/onboarding; parytet zachowania scrolla z resztą app). */}
      <main id='main-content' className={styles.main}>
        <div className={styles.content}>
          <NavigationContentShellComposition>
            {children}
          </NavigationContentShellComposition>
        </div>
      </main>
    </div>
  );
}
