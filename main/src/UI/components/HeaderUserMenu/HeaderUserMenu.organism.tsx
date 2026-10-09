import { useEffect, useState } from 'react';
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
import { useAppRole } from '../../layouts/useAppRole';
import { useDesktopAccess } from '../../layouts/useDesktopAccess';
import { AvatarAtom } from '../Avatar/Avatar.atom';
import { LinkButtonAtom } from '../Button/LinkButton.atom';
import { AppMenuAtom } from '../../primitives/AppMenu.atom';
import styles from './HeaderUserMenu.module.css';

/**
 * Account avatar + dropdown (Panel / Moje konto / Wyloguj). Shared by the
 * desktop public header and the mobile top-bar slot. It renders only the
 * authenticated-account chrome — callers gate WHETHER to mount it on
 * useHasLiveAccountSession(), so a stale token never paints a dropdown.
 */
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
  const displayName = user?.name?.trim() || user?.email || '';

  return (
    <AppMenuAtom>
      <AppMenuAtom.Trigger
        className={styles.trigger}
        aria-label={t('userMenu.ariaLabel')}>
        <AvatarAtom
          name={displayName}
          src={user?.image ?? undefined}
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
 * Auth-aware action for the public header (DESKTOP top-bar slot).
 * - Desktop without app access (useAppEntryMode 'get-app'): a "Pobierz
 *   aplikację" CTA — no login button, no account dropdown. The product is
 *   mobile-first; on PREVIEW/PRODUCTION desktop everything account-related
 *   funnels to /get-app (admin / become-user / devMode / DEV / STAGING keep
 *   the normal auth UI for development).
 * - Logged OUT (or pre-hydration, or STALE token): the "Zaloguj się" CTA.
 * - Logged IN (live session): avatar trigger → dropdown (Panel / Konto / Wyloguj).
 *
 * DECISION (nie usuwaj tego komentarza):
 * The `mounted` gate is load-bearing for SSR hydration. useHasLiveAccountSession()
 * derives from a localStorage token read (+ Better Auth session) — null on the
 * server, so the server ALWAYS renders the login CTA. Painting the avatar on the
 * client's first render would mismatch the server HTML. We render the login CTA
 * until mounted, then swap to the auth-aware UI on the client only (no hydration
 * mismatch). The same applies to the desktop 'get-app' swap: viewport is measured
 * in an effect, so SSR + first client render always paint the login CTA.
 *
 * DECISION (nie usuwaj tego komentarza):
 * We gate on useHasLiveAccountSession (live Better Auth session) — NOT raw
 * isLoggedIn (token-presence). A STALE token (dead backend session, e.g. dev DB
 * reseed) used to paint an avatar whose "Idź do panelu" dead-ended at
 * /user/login?from=/app (the first /app query 401s → LOGIN_FIRST). Gating on the
 * live session shows the login CTA for a stale token instead of a lying avatar.
 */
export function HeaderUserMenuOrganism() {
  const t = useTranslations('layout.public');
  const router = useRouter();
  const hasLiveSession = useHasLiveAccountSession();
  // Wave W3: route-aware — on an ACCOUNT route (login/onboarding/billing) the
  // desktop get-app bounce is lifted, so the header shows the login CTA there
  // even on a PREVIEW/PROD desktop. PRODUCT/STATIC routes keep the get-app CTA.
  const mode = useAppEntryModeForRoute(router.pathname);
  const panelHref = useAccountPanelHref();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (mounted && mode === 'get-app') {
    // get-app (desktop): primary CTA pobierania + drugorzędny, ludzki punkt
    // wejścia do konta (web-login-first): brak żywej sesji = „Zaloguj się",
    // żywa sesja = „Idź do panelu" (wzorzec jak MobilePanelCta na mobile).
    return (
      <>
        {/* Wypełnione zostaje pobranie; logowanie / panel to druga droga. */}
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
 * Mobile top-bar account avatar — sits LEFT of the hamburger (user 2026-06-25:
 * „na mobilce zrób to obok hamburgera, po lewej stronie od niego"). Logged-in
 * (live session) → avatar dropdown (same as desktop); logged-out / pre-hydration
 * / STALE token → renders nothing (login lives in the hamburger drawer via
 * MobilePanelCta). The mounted-gate mirrors the desktop header to avoid an SSR
 * hydration mismatch, and the live-session gate keeps a stale token from painting
 * a lying avatar in the mobile bar too.
 */
export function MobileAccountAvatarOrganism() {
  const hasLiveSession = useHasLiveAccountSession();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !hasLiveSession) {
    return null;
  }

  return <AccountMenuDropdown />;
}
