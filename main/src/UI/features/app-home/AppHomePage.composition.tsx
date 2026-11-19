import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import {
  BriefcaseIcon,
  CreditCardIcon,
  LifebuoyIcon,
  UserCircleIcon,
  StorefrontIcon,
  type Icon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import { DESKTOP_FRAME_MIN_WIDTH } from '../../../application/policies/desktop-access.policy';
import { resolveAccountSurface } from '../../../application/policies/account-surface.policy';
import { runInstant } from '../../../application/routing/navigation.possibilities.api';
import { buildRoute } from '../../../application/routing/buildRoute';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { GetAppHeroOrganism } from '../static/GetAppHero.organism';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { useAuth } from '../../contexts/AuthContext.composition';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { useDashboardFeed } from '../shared/dashboard/hooks/useDashboardFeed';
import { usePairedStylists } from '../shared/pairing/hooks/usePairedStylists';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../components/NavRow/NavRow.molecule';
import styles from './AppHomePage.module.css';

interface HomeRow {
  id: string;
  href: string;
  LinkIcon: Icon;
  title: string;
  desc: string;
}

/** How many stylist cards go into the list before it turns into a catalogue. */
const MAX_STYLIST_ROWS = 3;

/* DECISION: the rows are drawn by the SHARED primitive (NavRowMolecule inside
   NavRowListMolecule), with no local copy. This screen had its own list with square corners and
   a frame next to the rounded cards of the rest of the product ("Co dalej" looked like another
   program). The primitive decides how a row looks, in one place for the whole app; the screen
   supplies only content. (owner) */
function HomeRowLink({ row }: { row: HomeRow }) {
  const { href, LinkIcon, title, desc } = row;
  return (
    <NavRowMolecule
      href={href}
      icon={<LinkIcon size={20} weight='regular' />}
      label={title}
      description={desc}
      trailing='disc'
    />
  );
}

/**
 * Cards of the stylists the client is connected with — the ONLY product destination she has on
 * desktop.
 *
 * DECISION: product routes (`/app/gallery`, `/app/favorites`, `/app/pairing`) bounce desktop to
 * `/get-app` (route-access.policy), so a client's list could show only account and help: two
 * settings and no product. The public profile `/stylist/[identifier]` is category `static`,
 * reachable on every viewport, and shows exactly what a client comes for: her stylist's pinned
 * works. The component is mounted ONLY in the client variant, because usePairedStylists (via
 * usePairedList) pulls all pages of pairs; for a stylist (pair = her clients) that would fetch data
 * this screen does not show. Inactive pairs drop out: their profile no longer exists.
 */
function ClientStylistRows() {
  const t = useTranslations('pages.appHome');
  const { pairs } = usePairedStylists();

  return (
    <>
      {pairs
        .filter(pair => !pair.isInactive)
        .slice(0, MAX_STYLIST_ROWS)
        .map(pair => (
          <HomeRowLink
            key={pair.stylistAccountId}
            row={{
              id: pair.stylistAccountId,
              href: buildRoute(ROUTES_FRONT.STYLIST_PROFILE, {
                identifier: pair.stylistAccountId,
              }),
              LinkIcon: StorefrontIcon,
              // A card without a display name exists (the name is optional), and an empty title would leave a row
              // with only the description.
              title: pair.stylistDisplayName.trim() || t('stylistFallbackName'),
              desc: t('stylistDesc'),
            }}
          />
        ))}
    </>
  );
}

/**
 * Web-home of the `/app` zone. DECISION: /app/home is the logged-in DESKTOP start screen: a banner (the SAME component as the
 * /get-app hero, GetAppHero, shared on purpose so an edit lands in both) plus a short list of what
 * makes sense on a big screen (profile, account, billing, help). The product (gallery, clients,
 * sessions) stays mobile-only. The route is an account-route (route-access.policy), so desktop is
 * not bounced to /get-app; a narrow viewport goes back to the full dashboard /app with replace.
 * (owner)
 *
 * DECISION: the screen follows the ACTIVE role (account-surface.policy, the same SSOT as the rail
 * and the account screen) and WAITS for it to resolve: the client and stylist banners say opposite
 * things, so flashing the wrong one would be the bug this screen fixes. The hero gets its own
 * action: store buttons make no sense here (logged in, desktop, app not yet in Play), so one live
 * action for the role replaces the dead button.
 */
function AppHomePageInner() {
  const router = useRouter();
  const t = useTranslations('pages.appHome');
  const tButtons = useTranslations('buttons');
  const { accountType } = useAuth();
  const {
    data: currentUser,
    isError: isAccountError,
    isFetching: isAccountFetching,
    refetch: refetchAccount,
  } = useCurrentUserAccount();
  const { feed, isError: isFeedError } = useDashboardFeed(
    accountType === AccountTypeValue.STYLIST &&
      currentUser?.stylist_account != null
  );

  // One-shot latch (pattern `redirectFired` from useOnboardingPlanGuard): the decision is made ONCE,
  // on entering the screen. Without it every re-run of the effect (router identity change, remount)
  // could bounce the user mid-work if it hit a momentarily narrow measurement.
  const bouncedRef = useRef(false);

  // The session role is not in the build HTML (the page is static, the token lives in localStorage),
  // so the first CLIENT render must be identical to the server one, else React reports a hydration
  // mismatch and redraws the tree. So we prerender a skeleton and enter the content only after mount,
  // once the role is known. The screen is behind login, so static HTML has nothing to show here.
  const [isHydrated, setIsHydrated] = useState(false);
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || bouncedRef.current) {
      return;
    }
    // Measure AFTER mount (window.innerWidth is real then): useDesktopAccess starts from 0 and looks
    // like mobile for the first render, so reading it here would send desktop to /app on every entry.
    if (window.innerWidth >= DESKTOP_FRAME_MIN_WIDTH) {
      return;
    }
    bouncedRef.current = true;
    void runInstant(
      'app-home:mobile-has-full-product',
      () => router.replace(ROUTES_FRONT.APP),
      ROUTES_FRONT.APP
    );
  }, [router]);

  const hasStylistAccount = currentUser?.stylist_account != null;
  const surface = resolveAccountSurface({
    activeRole: accountType,
    hasStylistAccount,
    hasClientAccount: currentUser?.client_account != null,
  });
  const inStylistMode = surface.showStylistSections;

  // DECISION: wait for the user VALUE, not for a flag. `isAccountLoading` also drops on a query
  // ERROR, leaving `currentUser` undefined, so `hasStylistAccount` is false,
  // `resolveAccountSurface` switches the stylist sections off and the screen offers her "Become a
  // stylist", an account she already has: while it is unknown who she is, no role variant is safe
  // to show. The query error MUST have its own branch, otherwise the gate below turns an outage
  // into an endless skeleton (refetchOnWindowFocus is off and retries are capped, so nothing
  // recovers by itself; a 401 sends her to login via the auth guard, a 5xx or a dropped network
  // does not). The condition includes `currentUser === undefined` because TanStack keeps the data
  // when a query errors: without it a failed background refresh would turn a working screen into an
  // error message. The error shows only when there is nothing to show.
  if (isHydrated && isAccountError && currentUser === undefined) {
    return (
      <div className={styles.page}>
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={tButtons('retry')}
          onRetry={() => void refetchAccount()}
          isRetrying={isAccountFetching}
        />
      </div>
    );
  }

  if (!isHydrated || currentUser === undefined) {
    // Skeleton shape = screen shape (banner + list), so resolving the role does not move content
    // under the cursor.
    return (
      <div className={styles.page}>
        <SkeletonAtom variant='rect' width='100%' height={420} />
        <SkeletonAtom variant='rect' width='100%' height={240} />
      </div>
    );
  }

  const stylistRows: readonly HomeRow[] = [
    {
      id: 'profile',
      href: ROUTES_FRONT.STYLIST_PROFILE_MANAGE,
      LinkIcon: StorefrontIcon,
      title: t('profileTitle'),
      desc: t('profileDesc'),
    },
    {
      id: 'account',
      href: ROUTES_FRONT.USER_ACCOUNT,
      LinkIcon: UserCircleIcon,
      title: t('accountTitle'),
      desc: t('accountDesc'),
    },
    {
      id: 'billing',
      href: ROUTES_FRONT.USER_ACCOUNT_PAY,
      LinkIcon: CreditCardIcon,
      title: t('billingTitle'),
      desc: t('billingDesc'),
    },
    {
      id: 'support',
      href: ROUTES_FRONT.SUPPORT,
      LinkIcon: LifebuoyIcon,
      title: t('supportTitle'),
      desc: t('supportDesc'),
    },
  ];

  // Client: account and help, preceded by the product (her stylists' cards). The invitation to a
  // stylist account only for someone who does NOT have one — parity with `offerMissingRole` on the
  // account screen.
  const clientRows: readonly HomeRow[] = [
    {
      id: 'account',
      href: ROUTES_FRONT.USER_ACCOUNT,
      LinkIcon: UserCircleIcon,
      title: t('accountTitle'),
      desc: t('accountDesc'),
    },
    {
      id: 'support',
      href: ROUTES_FRONT.SUPPORT,
      LinkIcon: LifebuoyIcon,
      title: t('supportTitle'),
      desc: t('supportDesc'),
    },
    ...(hasStylistAccount
      ? []
      : [
          {
            id: 'become-stylist',
            href: ROUTES_FRONT.USER_ACTIVATE_STYLIST,
            LinkIcon: BriefcaseIcon,
            title: t('becomeStylistTitle'),
            desc: t('becomeStylistDesc'),
          },
        ]),
  ];

  const rows = inStylistMode ? stylistRows : clientRows;
  // Public page is ready once a work is pinned (same measure as the
  // activation step). Until the feed resolves, do not flash the setup CTA.
  const profileKnown = feed != null || isFeedError;
  const profileReady = feed != null && feed.pinned_count >= 1;

  return (
    <div className={styles.page}>
      <GetAppHeroOrganism
        headingId='app-home-heading'
        className={styles.hero}
        variant={inStylistMode ? 'app-stylist' : 'app-client'}
        actions={
          inStylistMode ? (
            profileReady ? (
              <p className={styles.heroNote}>{t('heroProfileReady')}</p>
            ) : profileKnown ? (
              <LinkButtonAtom
                href={ROUTES_FRONT.STYLIST_PROFILE_MANAGE}
                variant='primary'
                size='lg'>
                {t('heroCtaStylist')}
              </LinkButtonAtom>
            ) : null
          ) : (
            <LinkButtonAtom
              href={ROUTES_FRONT.USER_ACCOUNT}
              variant='primary'
              size='lg'>
              {t('heroCtaClient')}
            </LinkButtonAtom>
          )
        }
      />

      <section className={styles.next} aria-labelledby='app-home-next'>
        <div className={styles.nextHead}>
          <TypographyAtom
            variant='h2'
            id='app-home-next'
            data-app-section-title=''>
            {t('nextTitle')}
          </TypographyAtom>
          <TypographyAtom variant='body2' color='var(--color-text-secondary)'>
            {inStylistMode ? t('nextLedeStylist') : t('nextLedeClient')}
          </TypographyAtom>
        </div>

        <NavRowListMolecule ariaLabel={t('nextTitle')}>
          {!inStylistMode && <ClientStylistRows />}
          {rows.map(row => (
            <HomeRowLink key={row.id} row={row} />
          ))}
        </NavRowListMolecule>
      </section>
    </div>
  );
}

export function AppHomePageComposition() {
  const t = useTranslations('pages.appHome');
  return (
    <AppLayoutComposition title={t('appBarTitle')}>
      <AppHomePageInner />
    </AppLayoutComposition>
  );
}
