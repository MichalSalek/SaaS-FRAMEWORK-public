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

// DECISION (nie usuwaj tego komentarza) — owner 2026-09-22 (duplicated-
// navigation sweep): the admin drawer holds ONLY admin destinations plus the
// admin's own account. It used to carry the stylist/client product (gallery,
// add photo, favorites, browse stylists, shared, pairing): not the admin's work
// surface, and "Udostępnione" opened the stylist empty state. An admin sees the
// product through become-user, and then the drawer is that role's drawer
// anyway. "Pomoc" is gone too:
// /app/user/support is a user's inbox TO support, i.e. the admin talking to
// themselves (their queue is /app/admin/support inside the panel). The generic
// "Twój panel" home link is hidden for admin by the organism: it pointed at
// /app, which useAdminEntryGuard bounces to /app/admin, so it sat next to
// "Panel administratora" as a second item with the same destination.
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

// DECISION (nie usuwaj tego komentarza) — sesja z produkcji 2026-09-02:
// w onboardingu, ZANIM użytkowniczka wybierze rolę, konto ma jeszcze domyślne
// CLIENT, więc szuflada pokazywała etykietę „Klientka" i pełne menu klientki.
// Stylistka z ChatGPT otworzyła ją na pierwszym kroku, uznała, że założyła złe
// konto, skasowała je i odpadła przy drugiej próbie. Do wyboru roli szuflada
// nie zgaduje: zostaje tylko wyjście (owner 2026-07-12: lejek skupiony, nie
// pułapka). Po wyborze roli lejek podaje ją propem `drawerRole` w AppLayout.
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
