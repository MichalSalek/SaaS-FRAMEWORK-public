import {
  HouseIcon,
  CameraIcon,
  HeartIcon,
  GearIcon,
  ShieldIcon,
  PaletteIcon,
  SignOutIcon,
  QuestionIcon,
  FileTextIcon,
  UserIcon,
  ArrowClockwiseIcon,
} from '@phosphor-icons/react';
import type {
  DrawerSection,
  DrawerTranslator,
  LogoutFn,
} from './appDrawerSections';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';

// DECISION: the admin drawer holds ONLY admin destinations plus the admin's own account. The
// stylist/client product items are absent (an admin sees the product through become-user, and then
// the drawer is that role's drawer), and so is "Pomoc": /app/user/support is a user's inbox TO
// support, while the admin's queue is /app/admin/support. The generic "Twój panel" link is hidden
// for admin by the organism: it points at /app, which useAdminEntryGuard bounces to /app/admin,
// duplicating "Panel administratora". (owner)
export function getAdminSections(
  t: DrawerTranslator,
  logout: LogoutFn
): DrawerSection[] {
  return [
    {
      label: t('drawer.admin.sectionAdmin'),
      items: [
        {
          label: t('drawer.admin.adminPanel'),
          icon: <ShieldIcon size={18} />,
          path: ROUTES_FRONT.ADMIN,
        },
        {
          label: t('menu.colorsTraits'),
          icon: <PaletteIcon size={18} />,
          path: ROUTES_FRONT.ADMIN_COLORS_TRAITS,
        },
      ],
    },
    {
      items: [
        {
          label: t('drawer.user.myAccount'),
          icon: <GearIcon size={18} />,
          path: ROUTES_FRONT.USER_ACCOUNT,
        },
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

export function getGuestSections(t: DrawerTranslator): DrawerSection[] {
  return [
    {
      items: [
        {
          label: t('drawer.guest.home'),
          icon: <HouseIcon size={18} />,
          path: ROUTES_FRONT.HOME,
        },
        {
          label: t('nav.forStylists'),
          icon: <CameraIcon size={18} />,
          path: ROUTES_FRONT.FOR_STYLISTS,
        },
        {
          label: t('nav.forClients'),
          icon: <HeartIcon size={18} />,
          path: ROUTES_FRONT.FOR_CLIENTS,
        },
        {
          label: t('nav.loginOrSignup'),
          icon: <UserIcon size={18} />,
          path: ROUTES_FRONT.USER_LOG,
        },
      ],
    },
    {
      items: [
        {
          label: t('nav.pricing'),
          icon: <GearIcon size={18} />,
          path: ROUTES_FRONT.PRICING,
        },
        {
          label: t('nav.about'),
          icon: <FileTextIcon size={18} />,
          path: ROUTES_FRONT.ABOUT,
        },
        {
          label: t('menu.helpCenter'),
          icon: <QuestionIcon size={18} />,
          path: ROUTES_FRONT.HELP_CENTER,
        },
        {
          label: t('nav.contact'),
          icon: <FileTextIcon size={18} />,
          path: ROUTES_FRONT.CONTACT,
        },
      ],
    },
  ];
}

// DECISION: before the role is chosen in onboarding the account still defaults to CLIENT, so the
// drawer would show the "Klientka" label and the full client menu; a stylist who saw it took it
// for the wrong account, deleted it and dropped off. Until the role is picked the drawer guesses
// nothing and offers only the exit; after the pick the funnel passes the role as `drawerRole` in
// AppLayout. (owner)
export function getRoleUnresolvedSections(
  t: DrawerTranslator,
  logout: LogoutFn
): DrawerSection[] {
  return [
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
