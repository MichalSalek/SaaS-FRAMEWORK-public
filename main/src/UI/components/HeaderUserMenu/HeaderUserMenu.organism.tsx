import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import {
  CaretDownIcon,
  GearIcon,
  SignOutIcon,
  SquaresFourIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  useAuth,
  useCurrentUser,
  useHasLiveAccountSession,
} from '../../contexts/AuthContext.composition';
import { useAppEntryModeForRoute } from '../../shared/hooks/useAppEntryMode';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { useHydrated } from '../../hooks/useHydrated';
import { useAppRole } from '../../layouts/useAppRole';
import { useDesktopAccess } from '../../layouts/useDesktopAccess';
import { OwnPersonAvatarMolecule } from '../../shared/profile/OwnPersonAvatar.molecule';
import { LinkButtonAtom } from '../Button/LinkButton.atom';
import { AppMenuAtom } from '../../primitives/AppMenu.atom';
import styles from './HeaderUserMenu.module.css';

interface AccountMenuDropdownProps {
  panelHref?: string;
}

function AccountMenuDropdown({
  panelHref = ROUTES_FRONT.APP,
}: AccountMenuDropdownProps) {
  const t = useTranslations('layout.public');
  const router = useRouter();
  const { logout } = useAuth();
  const { user } = useCurrentUser();
  const { data: currentUser } = useCurrentUserAccount();
  const displayName =
    currentUser?.name?.trim() ||
    currentUser?.email ||
    user?.name?.trim() ||
    user?.email ||
    '';

  return (
    <AppMenuAtom>
      <AppMenuAtom.Trigger
        className={styles.trigger}
        aria-label={t('userMenu.ariaLabel')}>
        <OwnPersonAvatarMolecule
          person={
            currentUser ?? { name: displayName, image: user?.image ?? null }
          }
          size='sm'
        />
        <CaretDownIcon
          size={14}
          weight='bold'
          className={styles.caret}
          aria-hidden='true'
        />
      </AppMenuAtom.Trigger>
      <AppMenuAtom.Content align='end' sideOffset={10} className={styles.menu}>
        <AppMenuAtom.Item
          className={styles.item}
          onClick={() => void router.push(panelHref)}>
          <SquaresFourIcon size={18} aria-hidden='true' />
          {t('userMenu.panel')}
        </AppMenuAtom.Item>
        <AppMenuAtom.Item
          className={styles.item}
          onClick={() => void router.push(ROUTES_FRONT.USER_ACCOUNT)}>
          <GearIcon size={18} aria-hidden='true' />
          {t('userMenu.account')}
        </AppMenuAtom.Item>
        <AppMenuAtom.Separator />
        <AppMenuAtom.Item
          className={`${styles.item} ${styles.danger}`}
          onClick={logout}>
          <SignOutIcon size={18} aria-hidden='true' />
          {t('userMenu.logout')}
        </AppMenuAtom.Item>
      </AppMenuAtom.Content>
    </AppMenuAtom>
  );
}

function useAccountPanelHref(): string {
  const { isAdmin, isBecomeUser } = useAppRole();
  const desktopAccess = useDesktopAccess({ isAdmin, isBecomeUser });
  return desktopAccess === 'redirect'
    ? ROUTES_FRONT.USER_ACCOUNT
    : ROUTES_FRONT.APP;
}

/**
 * Auth-aware action for the public header (DESKTOP top-bar slot): desktop without app access
 * ('get-app') shows the download CTA plus a secondary login/panel link; logged OUT (or
 * pre-hydration, or a STALE token) shows "Zaloguj się"; a live session shows the avatar dropdown.
 *
 * DECISION: the `mounted` gate (`useHydrated`) is load-bearing for SSR hydration. The live session
 * comes from a localStorage token (null on the server), so the server ALWAYS renders the login CTA
 * and painting the avatar on the first client render would mismatch. The same holds for the
 * 'get-app' swap: the viewport is measured in an effect.
 */
export function HeaderUserMenuOrganism() {
  const t = useTranslations('layout.public');
  const router = useRouter();
  // DECISION: gate on useHasLiveAccountSession (live Better Auth session), NOT raw isLoggedIn
  // (token presence): a STALE token would paint an avatar whose "Idź do panelu" dead-ends at
  // login. Mechanism: UI/contexts/AuthContext.composition.tsx (useHasLiveAccountSession).
  const hasLiveSession = useHasLiveAccountSession();
  // Route-aware: on an ACCOUNT route (login/onboarding/billing) the
  // desktop get-app bounce is lifted, so the header shows the login CTA there
  // even on a PREVIEW/PROD desktop. PRODUCT/STATIC routes keep the get-app CTA.
  const mode = useAppEntryModeForRoute(router.pathname);
  const panelHref = useAccountPanelHref();
  const mounted = useHydrated();

  if (mounted && mode === 'get-app') {
    // get-app (desktop): the primary download CTA plus a secondary account
    // entry (web-login-first): no live session = „Zaloguj się", a live session
    // = „Idź do panelu" (the same pattern as MobilePanelCta on mobile).
    return (
      <>
        {/* The download stays filled; login / panel is the second path. */}
        <LinkButtonAtom
          href={hasLiveSession ? panelHref : ROUTES_FRONT.USER_LOG}
          variant='outlined'
          size='sm'
          className={styles.loginCta}>
          {hasLiveSession ? t('goToPanel') : t('loginButton')}
        </LinkButtonAtom>
        <LinkButtonAtom
          href={ROUTES_FRONT.GET_APP}
          variant='primary'
          size='sm'
          className={styles.loginCta}>
          {t('getAppButton')}
        </LinkButtonAtom>
        {hasLiveSession ? <AccountMenuDropdown panelHref={panelHref} /> : null}
      </>
    );
  }

  if (!mounted || !hasLiveSession) {
    return (
      <LinkButtonAtom
        href={ROUTES_FRONT.USER_LOG}
        variant='primary'
        size='sm'
        className={styles.loginCta}>
        {t('loginButton')}
      </LinkButtonAtom>
    );
  }

  return <AccountMenuDropdown panelHref={panelHref} />;
}

/**
 * Mobile top-bar account avatar — sits LEFT of the hamburger (owner). Logged-in
 * (live session) → avatar dropdown (same as desktop); logged-out / pre-hydration
 * / STALE token → renders nothing (login lives in the hamburger drawer via
 * MobilePanelCta). The mounted-gate mirrors the desktop header to avoid an SSR
 * hydration mismatch, and the live-session gate keeps a stale token from painting
 * a lying avatar in the mobile bar too.
 */
export function MobileAccountAvatarOrganism() {
  const hasLiveSession = useHasLiveAccountSession();
  const mounted = useHydrated();

  if (!mounted || !hasLiveSession) {
    return null;
  }

  return <AccountMenuDropdown />;
}
