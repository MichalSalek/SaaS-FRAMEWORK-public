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
  NotePencilIcon,
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
  /** Count badge on the item, rendered when > 0 (e.g. unread messages on „Wiadomości").
   *  Undefined/0 = no badge. */
  badgeCount?: number;
}

export interface DrawerSection {
  label?: string;
  items: DrawerItem[];
}

export type DrawerTranslator = (key: string) => string;

export type LogoutFn = () => void;

/**
 * Cold start: when explore is off, filter out the discovery items (explore + browse stylists)
 * and drop empty sections, so the drawer leads nowhere dead (consistent with the bottom nav,
 * which already hides them).
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
 * directly (owner: reporting a bug must not start with a search
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

export function getStylistSections(
  t: DrawerTranslator,
  logout: LogoutFn,
  salonStaffEnabled = true,
  unreadMessages = 0,
  salonInvitations: number | null = 0,
  unreadSupport = 0,
  salonOwner = false
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
        // Owner: the client list left the QR screen (a screen the
        // stylist turns towards a client) and got its own route and this
        // entry. AddressBook, not Users: the salon section's „Zespół salonu”
        // already wears Users in the same drawer.
        {
          label: t('drawer.user.myClients'),
          icon: <AddressBookIcon size={18} />,
          path: ROUTES_FRONT.CLIENTS,
        },
        // Her private notes (owner): the general note, notes about
        // clients, session and visit notes in one place.
        {
          label: t('drawer.user.notes'),
          icon: <NotePencilIcon size={18} />,
          path: ROUTES_FRONT.NOTES,
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
    // DECISION: the Salon section is gated on SALON_STAFF_ENABLED, but `salonStaffEnabled` comes
    // from usePublicFeatureFlag, which for this non-public flag resolves to FEATURE_FLAG_DEFAULTS
    // (true), so the nav-hide is inert today. The real enforcement is the api/v1/salon/staff/**
    // back-guard (404s every staff call when the kill-switch is off). The empty spread keeps the
    // DrawerSection[] shape clean if the flag ever resolves to false.
    ...(salonStaffEnabled
      ? [
          {
            label: t('menu.sectionSalon'),
            items: [
              ...(salonOwner
                ? [
                    {
                      label: t('components.salonSetupEntry.title'),
                      icon: <GearIcon size={18} />,
                      path: `${ROUTES_FRONT.STYLIST_PROFILE_MANAGE}?profile=salon`,
                    },
                  ]
                : []),
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
        // DECISION: this item leads to managing the public profile inside the app (/app/profile),
        // not straight to `/stylist/[id]`. The public route renders PublicLayout, a surface without
        // the tab bar and drawer (and without an address bar in the native shell), so entering it
        // from the menu trapped the user. The public page is one click away from the share card,
        // and PublicLayout now has a return bar for the native shell. (owner)
        {
          label: t('drawer.user.myPublicProfile'),
          icon: <UserIcon size={18} />,
          path: ROUTES_FRONT.STYLIST_PROFILE_MANAGE,
        },
        // DECISION: activating the second role ("Konto klientki") does not belong in the drawer:
        // the drawer is navigation, not actions or conversions. Entry is at the bottom
        // of account settings; the dashboard only switches between two active modes.
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
    // DECISION: no "Odkrywaj" entry here. It and "Przeglądaj stylistki" both opened /app/explore on
    // the "Stylizacje" tab, and "Odkrywaj" is already the client's bottom tab when EXPLORE_ENABLED
    // is on (with the flag off withoutDiscoveryWhenDisabled filters both out). The drawer keeps the
    // entry the tab bar lacks: STYLISTS (/app/stylists → /app/explore?tab=stylists).
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
        // DECISION: same as the client branch above (second-role activation is not a drawer item).
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
