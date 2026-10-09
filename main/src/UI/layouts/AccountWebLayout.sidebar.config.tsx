// UI/layouts/AccountWebLayout.sidebar.config.tsx
// Navigation taxonomy for AccountWebLayout (desktop >=1280 account chrome).
// Analog do AdminLayout.sidebar.config, ale flat (start + cztery trasy konta) —
// account = mniej powierzchni niż admin, sekcje byłyby przerostem.
//
// Trasy kontekstowe (recover / delete-self / activate-* / checkout/return) NIE
// są w rail-nav: to skupione flow docierane z treści (drawer/CTA), nie stałe
// pozycje nawigacji.
//
// SEKCJE USTAWIEŃ KONTA (owner 2026-10-08) są pod-pozycjami „Konto" — rail jest
// na desktopie JEDYNYM, stałym miejscem tego menu (wcześniej przyklejony pasek
// zakładek nad treścią). Lista sekcji ma jedno źródło:
// application/policies/account-sections.config.ts; „Aktywność" jest jedną z nich
// (/app/user/account/activity), więc nie dubluje pozycji głównej.
//
// „Start" (APP_HOME) i „Profil publiczny" doszły 2026-09-09 razem z web-home:
// pierwsza jest celem bounce'u z gołego /app, druga zastępuje wyjście z apki na
// publiczny profil (który nie ma powrotu). ROLOWE są „Profil publiczny" i
// „Płatności" — filtr rail-nav ukrywa je poza trybem stylistki
// (account-surface.policy). „Start" widzą obie role.

import type { ReactNode } from 'react';
import {
  HouseIcon,
  StorefrontIcon,
  UserCircleIcon,
  CreditCardIcon,
  LifebuoyIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  ACCOUNT_SECTIONS,
  buildAccountSectionHref,
  type AccountSectionId,
  type AccountSectionLabelKey,
} from '../../application/policies/account-sections.config';

type AccountWebNavKey =
  'navHome' | 'navProfile' | 'navAccount' | 'navBilling' | 'navSupport';

/** Sub-item of a rail item: one account settings section. */
export interface AccountWebNavChild {
  id: AccountSectionId;
  labelKey: AccountSectionLabelKey;
  path: string;
  tone: 'default' | 'danger';
}

export interface AccountWebNavItem {
  labelKey: AccountWebNavKey;
  path: string;
  icon: ReactNode;
  iconActive: ReactNode;
  /** Always visible under the item; the open one is marked from the URL. */
  children?: readonly AccountWebNavChild[];
}

const ACCOUNT_SECTION_CHILDREN: readonly AccountWebNavChild[] =
  ACCOUNT_SECTIONS.map(def => ({
    id: def.id,
    labelKey: def.labelKey,
    path: buildAccountSectionHref(def.id),
    tone: def.tone,
  }));

export const ACCOUNT_WEB_NAV: AccountWebNavItem[] = [
  {
    labelKey: 'navHome',
    path: ROUTES_FRONT.APP_HOME,
    icon: <HouseIcon size={19} weight='regular' />,
    iconActive: <HouseIcon size={19} weight='fill' />,
  },
  {
    labelKey: 'navProfile',
    path: ROUTES_FRONT.STYLIST_PROFILE_MANAGE,
    icon: <StorefrontIcon size={19} weight='regular' />,
    iconActive: <StorefrontIcon size={19} weight='fill' />,
  },
  {
    labelKey: 'navAccount',
    path: ROUTES_FRONT.USER_ACCOUNT,
    icon: <UserCircleIcon size={19} weight='regular' />,
    iconActive: <UserCircleIcon size={19} weight='fill' />,
    children: ACCOUNT_SECTION_CHILDREN,
  },
  {
    labelKey: 'navBilling',
    path: ROUTES_FRONT.USER_ACCOUNT_PAY,
    icon: <CreditCardIcon size={19} weight='regular' />,
    iconActive: <CreditCardIcon size={19} weight='fill' />,
  },
  {
    labelKey: 'navSupport',
    path: ROUTES_FRONT.SUPPORT,
    icon: <LifebuoyIcon size={19} weight='regular' />,
    iconActive: <LifebuoyIcon size={19} weight='fill' />,
  },
];
