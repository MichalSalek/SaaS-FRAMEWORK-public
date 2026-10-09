// UI/features/account/UserActivityPage.events.tsx
// Translations contract (TimelineTx: event titles), color-class registry (COLOR_CLASS),
// VisualSpec type and the resolveEventVisual lookup function. The actual
// raw-event → spec table lives in .events-map.tsx to keep both files
// under the 300 LOC ceiling.

import type { ReactNode } from 'react';
import type { EVENTS_ALL_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import { EVENT_MAP, FALLBACK_SPEC } from './UserActivityPage.events-map';
import styles from './UserActivityPage.module.css';

/* ============================================================
 *  Translations contract — passed from page shell
 * ============================================================ */

type TimelineTxKey =
  | 'humanLoggedIn'
  | 'humanLoggedOut'
  | 'humanCannotLogin'
  | 'humanSessionExpired'
  | 'humanSessionDeleted'
  | 'humanAllSessionsDeleted'
  | 'humanUserCreated'
  | 'humanUserRegistered'
  | 'humanAccountCreated'
  | 'humanUserDeletedSelf'
  | 'humanUserNameChanged'
  | 'humanEmailChangeRequested'
  | 'humanUserEmailChanged'
  | 'humanDisplayNameChanged'
  | 'humanPricingPlanChanged'
  | 'humanPaymentDone'
  | 'humanDataExported'
  | 'humanGalleryCreated'
  | 'humanGalleryUpdated'
  | 'humanGalleryDeleted'
  | 'humanGalleryPinned'
  | 'humanGalleryUnpinned'
  | 'humanAssetUploaded'
  | 'humanLocationSet'
  | 'humanVanityUrlSet'
  | 'humanFallback';

export type TimelineTx = Readonly<Record<TimelineTxKey, string>>;

export type EventCategoryKey = 'login' | 'account' | 'gallery' | 'security';

type ColorKey = 'success' | 'error' | 'warning' | 'primary' | 'info' | 'muted';

/* ============================================================
 *  Visual spec contract — shared with .events-map.tsx
 * ============================================================ */

export interface VisualSpec {
  icon: ReactNode;
  color: ColorKey;
  category: EventCategoryKey;
  titleKey: TimelineTxKey;
}

export interface EventVisual {
  icon: ReactNode;
  colorClass: string;
  categoryKey: EventCategoryKey;
  title: string;
}

const COLOR_CLASS: Readonly<Record<ColorKey, string>> = {
  success: styles.eventSuccess ?? '',
  error: styles.eventError ?? '',
  warning: styles.eventWarning ?? '',
  primary: styles.eventPrimary ?? '',
  info: styles.eventInfo ?? '',
  muted: styles.eventMuted ?? '',
};

/* ============================================================
 *  Resolve event → visual.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Lookup table > switch — dodawanie nowego eventu = jeden wiersz w
 * .events-map.tsx. Mapowanie jest exhaustywne dla NAJCZĘSTSZYCH eventów
 * user-facing. Reszta (admin, system, query-fetch) leci do fallback z
 * muted color. Nie eksportujemy listy wszystkich INFO eventów — to log
 * konsumenta, nie audit trail; chcemy odsiać szum.
 * ============================================================ */

export function resolveEventVisual(
  event: EVENTS_ALL_TYPE,
  tx: TimelineTx
): EventVisual {
  const spec = EVENT_MAP[event] ?? FALLBACK_SPEC;
  return {
    icon: spec.icon,
    colorClass: COLOR_CLASS[spec.color],
    categoryKey: spec.category,
    title: tx[spec.titleKey],
  };
}
