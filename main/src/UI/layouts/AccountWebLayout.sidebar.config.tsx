// DECISION: the desktop account rail (>=1280) is a flat list. Contextual
// flows (recover, delete, activate, checkout return) are reached from
// content, not from the rail. Settings are sub-items of „Konto"
// (account-sections.config.ts; „Aktywność" is one of them). „Start" is the
// bounce from bare /app. „Profil publiczny" replaces a public profile that
// has no way back. The role filter hides „Profil publiczny" and „Płatności"
// outside stylist mode (account-surface.policy). „Start" is visible to both
// roles. (owner)

import type { ReactNode } from 'react';
import {
  BellIcon,
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
  | 'navHome'
  | 'navNotifications'
  | 'navProfile'
  | 'navAccount'
  | 'navBilling'
  | 'navSupport';

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
  // Notification centre (v2): on the desktop the rail is the only place the
  // bell has (no app bar); the row carries the unread badge.
  {
    labelKey: 'navNotifications',
    path: ROUTES_FRONT.NOTIFICATIONS,
    icon: <BellIcon size={19} weight='regular' />,
    iconActive: <BellIcon size={19} weight='fill' />,
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
