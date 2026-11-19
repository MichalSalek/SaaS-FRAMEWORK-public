/**
 * Account settings sections: the single list behind the phone settings list (`/app/user/account`),
 * the section screens (`/app/user/account/[section]`) and the sub-items of the desktop rail item „Konto”.
 *
 * DECISION: the account screen works like phone settings (owner): a list of sections, each with its
 * OWN route, back returns to the list. A sticky tab strip (`?tab=`) floated with the scroll and had
 * no defined place; do not bring back a tab strip, a sticky section menu or a swipe between sections.
 *
 * Ids are English and part of the URL. Labels live in the CORE namespace `layout.accountWeb`, not
 * `account.page`: the rail renders on every account route and those pages do not load `account`.
 * Pure module (no React, no window); icons are mapped in `UI/features/account/accountSections.icons.ts`.
 */

import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../routing/buildRoute';

export const ACCOUNT_SECTION_IDS = [
  'account',
  'plan',
  'notifications',
  'appearance',
  'activity',
  'security',
  'data',
  'danger',
] as const;

export type AccountSectionId = (typeof ACCOUNT_SECTION_IDS)[number];

/** Namespace of `labelKey` and `descriptionKey`. */
export const ACCOUNT_SECTIONS_I18N_NAMESPACE = 'layout.accountWeb';

export type AccountSectionLabelKey =
  | 'sectionAccount'
  | 'sectionPlan'
  | 'sectionNotifications'
  | 'sectionAppearance'
  | 'sectionActivity'
  | 'sectionSecurity'
  | 'sectionData'
  | 'sectionDanger';

export type AccountSectionDescriptionKey = `${AccountSectionLabelKey}Desc`;

export interface AccountSectionDef {
  id: AccountSectionId;
  labelKey: AccountSectionLabelKey;
  /** One line saying what is inside, in the user's words. */
  descriptionKey: AccountSectionDescriptionKey;
  tone: 'default' | 'danger';
}

/** Display order = array order (list screen and rail). */
export const ACCOUNT_SECTIONS: readonly AccountSectionDef[] = [
  {
    id: 'account',
    labelKey: 'sectionAccount',
    descriptionKey: 'sectionAccountDesc',
    tone: 'default',
  },
  {
    id: 'plan',
    labelKey: 'sectionPlan',
    descriptionKey: 'sectionPlanDesc',
    tone: 'default',
  },
  {
    id: 'notifications',
    labelKey: 'sectionNotifications',
    descriptionKey: 'sectionNotificationsDesc',
    tone: 'default',
  },
  {
    id: 'appearance',
    labelKey: 'sectionAppearance',
    descriptionKey: 'sectionAppearanceDesc',
    tone: 'default',
  },
  {
    id: 'activity',
    labelKey: 'sectionActivity',
    descriptionKey: 'sectionActivityDesc',
    tone: 'default',
  },
  {
    id: 'security',
    labelKey: 'sectionSecurity',
    descriptionKey: 'sectionSecurityDesc',
    tone: 'default',
  },
  {
    id: 'data',
    labelKey: 'sectionData',
    descriptionKey: 'sectionDataDesc',
    tone: 'default',
  },
  {
    id: 'danger',
    labelKey: 'sectionDanger',
    descriptionKey: 'sectionDangerDesc',
    tone: 'danger',
  },
];

/** The section a desktop renders on the bare `/app/user/account`. */
export const DEFAULT_ACCOUNT_SECTION: AccountSectionId = 'account';

const SECTION_BY_ID: ReadonlyMap<string, AccountSectionDef> = new Map(
  ACCOUNT_SECTIONS.map(def => [def.id, def])
);

function firstValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

/** A raw route param (or query value) → section id; unknown → null. */
export function resolveAccountSection(
  raw: string | string[] | undefined
): AccountSectionId | null {
  const value = firstValue(raw);
  if (value === undefined) {
    return null;
  }
  return SECTION_BY_ID.get(value)?.id ?? null;
}

export function getAccountSectionDef(id: AccountSectionId): AccountSectionDef {
  const def = SECTION_BY_ID.get(id);
  if (def === undefined) {
    // Unreachable for a typed id; the map is built from the same array.
    throw new Error(`Unknown account section: ${id}`);
  }
  return def;
}

export function buildAccountSectionHref(id: AccountSectionId): string {
  return buildRoute(ROUTES_FRONT.USER_ACCOUNT_SECTION, { section: id });
}

/**
 * The retired `?tab=` values. Used ONLY to redirect old links (e-mails,
 * bookmarks, `/app/user/activity`) to the matching section route.
 */
const LEGACY_TAB_TO_SECTION: Readonly<Record<string, AccountSectionId>> = {
  konto: 'account',
  preferences: 'notifications',
  appearance: 'appearance',
  activity: 'activity',
  security: 'security',
  data: 'data',
  danger: 'danger',
};

/** A raw legacy `?tab=` value → section id; missing or unknown → null. */
export function resolveLegacyAccountTab(
  raw: string | string[] | undefined
): AccountSectionId | null {
  const value = firstValue(raw);
  if (value === undefined || !Object.hasOwn(LEGACY_TAB_TO_SECTION, value)) {
    return null;
  }
  return LEGACY_TAB_TO_SECTION[value] ?? null;
}

/**
 * The section a rail marks as current: the bare account route shows the
 * default section on desktop, a section route shows its own.
 */
export function resolveActiveAccountSection(
  pathname: string,
  sectionParam: string | string[] | undefined
): AccountSectionId | null {
  if (pathname === ROUTES_FRONT.USER_ACCOUNT) {
    return DEFAULT_ACCOUNT_SECTION;
  }
  if (pathname === ROUTES_FRONT.USER_ACCOUNT_SECTION) {
    return resolveAccountSection(sectionParam);
  }
  return null;
}
