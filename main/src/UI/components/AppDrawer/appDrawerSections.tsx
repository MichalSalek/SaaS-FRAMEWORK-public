import {
  AddressBookIcon,
  CameraIcon,
  PlusCircleIcon,
  HeartIcon,
  MagnifyingGlassIcon,
  ShareNetworkIcon,
  QrCodeIcon,
  UserIcon,
  UsersIcon,
  GearIcon,
  SignOutIcon,
  ChatCircleDotsIcon,
  ChatsCircleIcon,
  ArrowClockwiseIcon,
  EnvelopeSimpleOpenIcon,
  BugBeetleIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';

/* ─── Types ─── */

// Inlined from prototype @/context/RoleContext (not available in main/src)
export type UserRole = 'stylist' | 'client' | 'admin';

interface DrawerItem {
  label: string;
  icon: React.ReactNode;
  path?: string;
  action?: () => void;
  danger?: boolean;
  /** Licznik na pozycji (badge) — renderowany gdy > 0. Np. nieprzeczytane
   *  wiadomości na „Wiadomości". Undefined/0 = brak badge'a. */
  badgeCount?: number;
}

export interface DrawerSection {
  label?: string;
  items: DrawerItem[];
}

export type DrawerTranslator = (key: string) => string;

export type LogoutFn = () => void;

/**
 * Cold-start: gdy explore wyłączone, odfiltruj pozycje discovery (explore +
 * przeglądaj-stylistki) i porzuć puste sekcje — żeby drawer nie prowadził
 * donikąd (spójnie z bottom-nav, który już je ukrywa).
 */
export function withoutDiscoveryWhenDisabled(
  sections: DrawerSection[],
  exploreEnabled: boolean
): DrawerSection[] {
  if (exploreEnabled) {
    return sections;
  }
  return sections
    .map(s => ({
      ...s,
      items: s.items.filter(
        it =>
          it.path !== ROUTES_FRONT.EXPLORE && it.path !== ROUTES_FRONT.STYLISTS
      ),
    }))
    .filter(s => s.items.length > 0);
}

/**
 * „Zaproszenia do salonu”. The invitation is addressed to the PERSON, so both
 * role variants carry it. Contract of `salonInvitations`:
 *   n > 0 → item with a badge of n;
 *   null  → item WITHOUT a badge: the read failed, the count is unknown, and the
 *           screen (which shows the error with a retry) must stay reachable;
 *   0     → no item (nothing pending, or not known yet).
 */
function salonInvitationsItems(
  t: DrawerTranslator,
  salonInvitations: number | null
): DrawerItem[] {
  if (salonInvitations === 0) {
    return [];
  }
  return [
    {
      label: t('drawer.user.salonInvitations'),
      icon: <EnvelopeSimpleOpenIcon size={18} />,
      path: ROUTES_FRONT.SALON_INVITATIONS,
      ...(salonInvitations !== null ? { badgeCount: salonInvitations } : {}),
    },
  ];
}

/**
 * „Pomoc” + „Zgłoś błąd lub pomysł”, the same pair for both roles. „Pomoc”
 * carries the number of support threads with a reply the user has not opened
 * (0 or unknown = no badge). The second entry opens the new-request form
 * directly (owner 2026-10-08: reporting a bug must not start with a search
 * through the help screen).
 */
function supportItems(
  t: DrawerTranslator,
  unreadSupport: number
): DrawerItem[] {
  return [
    {
      label: t('menu.helpCenter'),
      icon: <ChatCircleDotsIcon size={18} />,
      path: ROUTES_FRONT.SUPPORT,
      badgeCount: unreadSupport,
    },
    {
      label: t('drawer.user.reportBugOrIdea'),
      icon: <BugBeetleIcon size={18} />,
      path: ROUTES_FRONT.SUPPORT_NEW,
    },
  ];
}

/* ─── Drawer content per role (from TARGET_ROUTING_AND_JOURNEY_MAP.md §4) ─── */

// S82 zdjął martwe parametry _navigate/_onClose z wariantu stylistki i klientki
// (nawigacja idzie po item.path w organizmie, akcje przez closures logout), ale
// zapisał przy tym, że warianty gościa i admina „nadal biorą navigate+onClose
// (realnie używane)" — nieprawda: obie funkcje trzymały je pod prefiksem `_`
// i nigdzie nie tykały. Komentarz usprawiedliwiał martwy kod, który przeżył
// własną czystkę, a razem z nim typ NavigateFn istniejący wyłącznie po to, by
// otypować te parametry. Wszystkie cztery argumenty i typ zniknęły w S103.
export function getStylistSections(
  t: DrawerTranslator,
  logout: LogoutFn,
  salonStaffEnabled = true,
  unreadMessages = 0,
  salonInvitations: number | null = 0,
  unreadSupport = 0
): DrawerSection[] {
  return [
    {
      label: t('menu.sectionGallery'),
      items: [
        {
          label: t('drawer.user.addPhoto'),
          icon: <PlusCircleIcon size={18} />,
          path: ROUTES_FRONT.GALLERY_UPLOAD_ASSET,
        },
        {
          label: t('drawer.user.myGallery'),
          icon: <CameraIcon size={18} />,
          path: ROUTES_FRONT.GALLERY,
        },
      ],
    },
    {
      label: t('menu.sectionClients'),
      items: [
        // Owner 2026-10-09: the client list left the QR screen (a screen the
        // stylist turns towards a client) and got its own route and this
        // entry. AddressBook, not Users: the salon section's „Zespół salonu”
        // already wears Users in the same drawer.
        {
          label: t('drawer.user.myClients'),
          icon: <AddressBookIcon size={18} />,
          path: ROUTES_FRONT.CLIENTS,
        },
        {
          label: t('drawer.user.sharedFromClients'),
          icon: <ShareNetworkIcon size={18} />,
          path: ROUTES_FRONT.SHARED,
        },
        {
          label: t('drawer.user.qrPairing'),
          icon: <QrCodeIcon size={18} />,
          path: ROUTES_FRONT.PAIRING,
        },
        {
          label: t('drawer.user.messages'),
          icon: <ChatsCircleIcon size={18} />,
          path: ROUTES_FRONT.MESSAGES,
          badgeCount: unreadMessages,
        },
        {
          label: t('drawer.user.browseStylist'),
          icon: <MagnifyingGlassIcon size={18} />,
          path: ROUTES_FRONT.STYLISTS,
        },
      ],
    },
    // DECISION (nie usuwaj tego komentarza):
    // Salon section gated on SALON_STAFF_ENABLED. salonStaffEnabled comes from
    // usePublicFeatureFlag in AppDrawer — which for this non-public flag resolves to
    // FEATURE_FLAG_DEFAULTS (=true), mirroring the front route gate. CONSEQUENCE: while the
    // flag stays non-public this nav-hide is INERT (always true → link always shown); it is
    // ready scaffolding. The real enforcement is the api/v1/salon/staff/** back-guard, which
    // 404s every staff API call when the kill-switch is off (the page renders, its data
    // calls fail gracefully). Empty-section spread keeps the DrawerSection[] shape clean if
    // the flag is ever resolved to false.
    ...(salonStaffEnabled
      ? [
          {
            label: t('menu.sectionSalon'),
            items: [
              ...salonInvitationsItems(t, salonInvitations),
              {
                label: t('drawer.user.salonStaff'),
                icon: <UsersIcon size={18} />,
                path: ROUTES_FRONT.SALON_STAFF,
              },
            ],
          },
        ]
      : []),
    {
      items: [
        // DECISION (nie usuwaj tego komentarza) — owner 2026-07-11, zmienione
        // 2026-09-09: pozycja prowadzi do ZARZĄDZANIA profilem publicznym
        // wewnątrz aplikacji (/app/profile), nie wprost na `/stylist/[id]`.
        // Publiczna trasa renderuje PublicLayout, czyli powierzchnię BEZ dolnej
        // belki i bez szuflady, a w natywnej skorupie także bez paska adresu:
        // wejście tam z menu kończyło się uwięzieniem („już nie mogę stamtąd
        // wyjść po prostu na apce", zgłoszenie ownera). Sama strona publiczna
        // jest o jedno kliknięcie dalej, z karty udostępniania — a PublicLayout
        // ma teraz pasek powrotu dla skorupy natywnej.
        // Label nie kłamie: /app/profile pokazuje podgląd, adres profilu i to,
        // co klientka widzi, plus przypięte prace.
        {
          label: t('drawer.user.myPublicProfile'),
          icon: <UserIcon size={18} />,
          path: ROUTES_FRONT.STYLIST_PROFILE_MANAGE,
        },
        // DECISION (nie usuwaj tego komentarza):
        // Aktywacja drugiej roli ("Konto klientki") NIE należy do drawera —
        // drawer = nawigacja, nie akcje/konwersje. Wejście do ActivateRolePage
        // przeniesione na kontekstową kartę „Rozszerz konto" na dashboardzie
        // (ExpandAccountCard, single-role only). Patrz DashboardPage roleZone.
        {
          label: t('drawer.user.myAccountAndPlan'),
          icon: <GearIcon size={18} />,
          path: ROUTES_FRONT.USER_ACCOUNT,
        },
        ...supportItems(t, unreadSupport),
      ],
    },
    {
      items: [
        {
          label: t('menu.refreshApp'),
          icon: <ArrowClockwiseIcon size={18} />,
          action: () => {
            window.location.reload();
          },
        },
        {
          label: t('menu.logout'),
          icon: <SignOutIcon size={18} />,
          action: logout,
          danger: true,
        },
      ],
    },
  ];
}

export function getClientSections(
  t: DrawerTranslator,
  logout: LogoutFn,
  unreadMessages = 0,
  salonInvitations: number | null = 0,
  unreadSupport = 0
): DrawerSection[] {
  return [
    // DECISION (nie usuwaj tego komentarza) — S122 QA: no "Odkrywaj" entry
    // here. It and "Przeglądaj stylistki" both opened /app/explore on the
    // "Stylizacje" tab (two items, one screen), and "Odkrywaj" is already the
    // client's bottom tab whenever EXPLORE_ENABLED is on (with the flag off
    // both are filtered out by withoutDiscoveryWhenDisabled). The drawer keeps
    // the entry the tab bar does not have: STYLISTS, which lands on the
    // "Stylistki" tab (/app/stylists → /app/explore?tab=stylists).
    {
      label: t('menu.sectionInspiration'),
      items: [
        {
          label: t('drawer.user.myFavorites'),
          icon: <HeartIcon size={18} />,
          path: ROUTES_FRONT.FAVORITES,
        },
        {
          label: t('drawer.user.browseStylist'),
          icon: <UsersIcon size={18} />,
          path: ROUTES_FRONT.STYLISTS,
        },
      ],
    },
    {
      label: t('menu.sectionCommunication'),
      items: [
        {
          label: t('drawer.user.sharedToStylist'),
          icon: <ShareNetworkIcon size={18} />,
          path: ROUTES_FRONT.SHARED,
        },
        {
          label: t('drawer.user.myConnections'),
          icon: <QrCodeIcon size={18} />,
          path: ROUTES_FRONT.PAIRING,
        },
        {
          label: t('drawer.user.messages'),
          icon: <ChatsCircleIcon size={18} />,
          path: ROUTES_FRONT.MESSAGES,
          badgeCount: unreadMessages,
        },
      ],
    },
    {
      items: [
        ...salonInvitationsItems(t, salonInvitations),
        {
          label: t('drawer.user.myProfile'),
          icon: <UserIcon size={18} />,
          path: ROUTES_FRONT.CLIENT_PROFILE,
        },
        // DECISION (nie usuwaj tego komentarza):
        // Aktywacja drugiej roli ("Konto stylistki") NIE należy do drawera —
        // drawer = nawigacja, nie akcje/konwersje. Wejście do ActivateRolePage
        // przeniesione na kontekstową kartę „Rozszerz konto" na dashboardzie
        // (ExpandAccountCard, single-role only). Patrz DashboardPage roleZone.
        {
          label: t('drawer.user.myAccount'),
          icon: <GearIcon size={18} />,
          path: ROUTES_FRONT.USER_ACCOUNT,
        },
        ...supportItems(t, unreadSupport),
      ],
    },
    {
      items: [
        {
          label: t('menu.refreshApp'),
          icon: <ArrowClockwiseIcon size={18} />,
          action: () => {
            window.location.reload();
          },
        },
        {
          label: t('menu.logout'),
          icon: <SignOutIcon size={18} />,
          action: logout,
          danger: true,
        },
      ],
    },
  ];
}

// Re-export admin + guest from split file
export {
  getAdminSections,
  getGuestSections,
  getRoleUnresolvedSections,
} from './appDrawerSections.admin';
