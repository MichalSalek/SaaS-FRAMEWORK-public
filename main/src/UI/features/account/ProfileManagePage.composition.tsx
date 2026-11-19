// UI/features/account/ProfileManagePage.composition.tsx
// „Twój publiczny profil" — jedno miejsce, w którym stylistka konfiguruje to,
// co widzi klientka: wizytówkę, adres profilu, kolor marki i przypięte prace.
//
// DECISION: public-profile configuration lives HERE. It used to be one section buried in the
// "Konto" tab where nobody found it; the section moved here and the account keeps a link to it (one
// address, one owner of the topic). The side-menu item "Twój publiczny profil" leads here, not
// straight to `/stylist/[identifier]`: that route is outside the app shell (PublicLayout has no tab
// bar and a WebView has no address bar), which trapped the stylist. Going out to the public page is
// a deliberate step from the share card (plus a return bar in PublicLayout for the native shell).
// (owner)
// The route is an `account-route`, so it also works on a laptop: writing the
// bio and vanity link is desk work, not work at the station.

import { useEffect, useRef, useState } from 'react';
import {
  confirmDiscard,
  isLeaveGuardArmed,
} from '../../../application/routing/leave-guard';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { runInstant } from '../../../application/routing/navigation.possibilities.api';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import type { SafeStylistAccountWire } from '@kernel/domain/user/user.contract-schemas';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { StorefrontIcon } from '@phosphor-icons/react';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { ProfileLinkCardOrganism } from '../shared/profile/ProfileLinkCard.organism';
import { buildRoute } from '../../../application/routing/buildRoute';
import { StylistProfileSectionOrganism } from './components/StylistProfileSection.organism';
import { PinnedManagerOrganism } from './components/PinnedManager.organism';
import { authClient } from '../../../application/auth/better-auth-client';
import { useAuth } from '../../contexts/AuthContext.composition';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { useIsStylist } from '../../shared/hooks/useSessionRole';
import { SegmentedControlMolecule } from '../../components/SegmentedControl/SegmentedControl.molecule';
import {
  useUrlSyncedState,
  type UrlStateCodec,
} from '../../shared/hooks/useUrlSyncedState';
import { SalonProfileManageOrganism } from '../salon-profile/SalonProfileManage.organism';
import { hasOwnSalon } from '../../../application/policies/salon-ownership.policy';
import styles from './ProfileManagePage.module.css';

function ProfileManagePageInner() {
  const t = useTranslations('account.profileManage');
  const tButtons = useTranslations('buttons');
  useAppBarTitle(t('title'));
  const router = useRouter();
  const {
    data: user,
    isLoading,
    isFetching,
    refetch,
  } = useCurrentUserAccount();
  const isStylist = useIsStylist();
  // The active role comes from the Better Auth session. While the session is
  // PENDING, `accountType` is null and `useIsStylist()` wrongly says "not a
  // stylist"; without this gate the screen bounced stylists to the account.
  const {
    isPending: isSessionPending,
    data: session,
    error: sessionError,
  } = authClient.useSession();
  const { isLoggedIn } = useAuth();
  const lastConfirmedUser = useRef<string | null>(null);
  const sessionUserId = session?.user?.id;
  const userMatches = Boolean(user && sessionUserId === user.id);
  if (
    !isSessionPending &&
    isLoggedIn &&
    user &&
    isStylist &&
    (userMatches || (!session && sessionError && sessionError.status !== 401))
  ) {
    lastConfirmedUser.current = user.id;
  }
  const canKeepDraft = Boolean(
    isLoggedIn && user && user.id === lastConfirmedUser.current
  );
  const identityMismatch = Boolean(
    sessionUserId && user && sessionUserId !== user.id
  );
  const sessionInvalid =
    !isSessionPending &&
    !session &&
    (!sessionError || sessionError.status === 401);
  const temporarilyUnverified =
    !userMatches && !identityMismatch && !sessionInvalid;
  const hideBody = !isLoggedIn || identityMismatch || sessionInvalid;
  const blockEditing =
    isSessionPending ||
    Boolean(sessionError) ||
    temporarilyUnverified ||
    hideBody;
  const stylistAccount = user?.stylist_account ?? null;

  // DECISION: mount-gate, same reason as AccountPayPage.composition.tsx: SSR has `isLoading ===
  // false` and would render the empty state "this place is for stylists" while the first client
  // render has a token and renders a skeleton (hydration mismatch). SSR and the first CSR must
  // render an IDENTICAL skeleton.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Client mode has no public profile. The route is in the stylist and admin
  // permissions, but a dual-role user can reach it by tab in client mode. Send
  // them to the account, where the „przełącz tryb” card lives.
  useEffect(() => {
    if (!mounted || isLoading || isSessionPending || isStylist) {
      return;
    }
    void runInstant(
      'profile-manage:not-in-stylist-mode',
      () => router.replace(ROUTES_FRONT.USER_ACCOUNT),
      ROUTES_FRONT.USER_ACCOUNT
    );
  }, [mounted, isLoading, isSessionPending, isStylist, router]);

  if (
    !mounted ||
    isLoading ||
    (user === undefined && isSessionPending) ||
    (user !== undefined && blockEditing && !canKeepDraft)
  ) {
    return (
      <div className={styles.page}>
        {/* Pudełka o docelowej geometrii: nagłówek, karta udostępniania,
            sekcja przypiętych prac. */}
        <SkeletonAtom variant='rect' width='100%' height={104} />
        <SkeletonAtom variant='rect' width='100%' height={288} />
        <SkeletonAtom variant='rect' width='100%' height={360} />
      </div>
    );
  }

  // DECISION: a failed query is NOT "you are not a stylist". `isLoading` also drops on error, then
  // `user` stays `undefined` and `stylistAccount` comes out `null`, so the screen ruled on
  // something it had not measured: it parked a real stylist on "this place is for stylists". The
  // redirect to the account did not save her either, because the session's `isStylist` is then
  // `true` and the redirect effect exits early. Unresolved is shown as an error with a retry, not as
  // a verdict about the role. The condition is the mere ABSENCE OF DATA, not `isError`: TanStack
  // keeps data while setting the error status, so a failed background refresh would otherwise throw
  // her out of a working card editor.
  if (user === undefined) {
    return (
      <div className={styles.page}>
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={tButtons('retry')}
          onRetry={() => void refetch()}
          isRetrying={isFetching}
        />
      </div>
    );
  }

  if ((!isStylist && !blockEditing) || stylistAccount === null) {
    return (
      <div className={styles.page}>
        <EmptyStateAtom
          size='page'
          icon={<StorefrontIcon size={32} weight='duotone' />}
          title={t('noStylistTitle')}
          titleAs='h2'
          description={t('noStylistBody')}
          action={
            <LinkButtonAtom
              href={ROUTES_FRONT.USER_ACCOUNT}
              variant='primary'
              size='md'>
              {t('noStylistCta')}
            </LinkButtonAtom>
          }
        />
      </div>
    );
  }

  return (
    <>
      {blockEditing && !hideBody && <p role='status'>{t('sessionChecking')}</p>}
      <div inert={blockEditing} aria-busy={blockEditing} hidden={hideBody}>
        <ProfileManageBody key={user.id} stylistAccount={stylistAccount} />
      </div>
    </>
  );
}

/* DECISION: layout of the profile screens (owner and 2026-10-21). Both profiles, the
 * stylist's own and the salon's, are ONE structure so she finds the same thing in the same place:
 * (1) Title, the profile switch, then the link card (ProfileLinkCard): „Zobacz profil” with an eye
 *     first, the address with „Kopiuj” and the filled „Udostępnij link” (sharing is the daily action).
 *     An account WITHOUT an address still opens its profile (by id), but has no link worth sending:
 *     the card says where to set it.
 * (2) Below, from 720px of own width two columns: left what is done here daily (pinned works, which
 *     need width), right the fields, which read well in a narrow column. On a phone the fields lead
 *     until the profile has an address (latched at mount so nothing jumps after saving), then the
 *     pinned works lead.
 * (3) The header meta carries only views. The address stands in the link card and the pinned
 *     count in the header of its section: one fact, one place. */
const profileTargetCodec: UrlStateCodec<'personal' | 'salon'> = {
  keys: ['profile'],
  parse: query => (query.profile === 'salon' ? 'salon' : 'personal'),
  build: state => (state === 'salon' ? { profile: 'salon' } : {}),
};

function ProfileManageBody({
  stylistAccount,
}: {
  stylistAccount: SafeStylistAccountWire;
}) {
  const t = useTranslations('account.profileManage');
  const tSalon = useTranslations('salon.profile');
  const [target, setTarget, targetReady] =
    useUrlSyncedState(profileTargetCodec);
  const ownSalon = hasOwnSalon(stylistAccount) || target === 'salon';
  const hasAddress = Boolean(stylistAccount.vanity_url);
  const [formLeads] = useState(() => !hasAddress);

  if (!targetReady) {
    return <SkeletonAtom variant='rect' width='100%' height={300} />;
  }

  return (
    <div className={styles.page}>
      <AppHeroOrganism
        title={t('title')}
        // The salon view is named by the switch right below; repeating it
        // here made three „profil publiczny” lines in a row (clean-context reader).
        {...(!(ownSalon && target === 'salon') && {
          meta: (
            <span>{t('metaViews', { count: stylistAccount.view_count })}</span>
          ),
        })}
      />

      {ownSalon && (
        <SegmentedControlMolecule
          value={target}
          onChange={next => {
            if (isLeaveGuardArmed()) {
              const message =
                target === 'salon' ? tSalon('unsaved') : t('bioUnsaved');
              void confirmDiscard(message).then(confirmed => {
                if (confirmed) {
                  setTarget(next);
                }
              });
            } else {
              setTarget(next);
            }
          }}
          ariaLabel={tSalon('chooseProfile')}
          options={[
            { value: 'personal', label: tSalon('personalProfile') },
            { value: 'salon', label: tSalon('salonProfile') },
          ]}
        />
      )}
      {ownSalon && target === 'salon' ? (
        <SalonProfileManageOrganism />
      ) : (
        <>
          <ProfileLinkCardOrganism
            target='stylist'
            viewPath={buildRoute(ROUTES_FRONT.STYLIST_PROFILE, {
              identifier:
                stylistAccount.vanity_url || stylistAccount.account_id,
            })}
            sharePath={
              stylistAccount.vanity_url
                ? buildRoute(ROUTES_FRONT.STYLIST_PROFILE, {
                    identifier: stylistAccount.vanity_url,
                  })
                : null
            }
            notice={t('noAddressNotice')}
          />
          <PageColumnsMolecule
            asideSize='wide'
            narrowFirst={formLeads ? 'aside' : 'main'}
            main={<PinnedManagerOrganism />}
            aside={
              <StylistProfileSectionOrganism stylistAccount={stylistAccount} />
            }
          />
        </>
      )}
    </div>
  );
}

export function ProfileManagePageComposition() {
  const t = useTranslations('account.profileManage');
  return (
    <AppLayoutComposition title={t('title')}>
      <ProfileManagePageInner />
    </AppLayoutComposition>
  );
}
