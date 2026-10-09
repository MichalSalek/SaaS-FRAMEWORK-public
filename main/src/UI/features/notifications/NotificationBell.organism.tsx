// UI/features/notifications/NotificationBell.organism.tsx
// Dzwoneczek powiadomień — WERSJA v1 (2026-07-12).
//
// FILOZOFIA v1: „agregator istniejących sygnałów", nie system powiadomień.
// Nie ma domeny notifications, rekordów przeczytane/nieprzeczytane ani realtime.
// Dzwoneczek zbiera liczniki, które apka i tak już liczy (nowe sesje od klientek
// = pending_shares_count z dashboard-feed; oczekujące prośby o połączenie =
// usePendingRequests) i wystawia je jednym glanceable-badge + rozwijaną listą
// z deep-linkami. Pełną przeróbkę na v2 (własna domena, unread per-event, push)
// opisuje docs/PLANS_TODO/NOTIFICATIONS_V2_PRE_PLAN.md.
//
// ZAKRES v1: tylko STYLISTKA (ma jasne pending-actionable). Klientka nie ma dziś
// odrębnego pending-sygnału w modelu, więc gate roli żyje po stronie AppLayout
// (renderujemy dzwoneczek tylko dla roli 'stylist') — v2 obejmie też klientkę.

import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import {
  BellIcon,
  TrayArrowDownIcon,
  HandWavingIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { AppMenuAtom } from '../../primitives/AppMenu.atom';
import { useDashboardFeed } from '../shared/dashboard/hooks/useDashboardFeed';
import { usePendingRequests } from '../shared/pairing/hooks/usePairRequests';
import styles from './NotificationBell.module.css';

export function NotificationBellOrganism() {
  const t = useTranslations('notifications');
  const router = useRouter();

  // Oba źródła to ISTNIEJĄCE query (React Query dedupuje po kluczu — współdzielą
  // cache z dashboardem / ekranem klientek, więc dzwoneczek nie mnoży requestów).
  // Poll pending-requests łagodniejszy niż na ekranie klientek (60s vs 30s):
  // globalny badge nie musi być sekundowo świeży, a query żyje na każdej stronie.
  const { feed, isError: feedError, refetch: refetchFeed } = useDashboardFeed();
  const pending = usePendingRequests(true, 60_000);

  const sharesCount = feed?.pending_shares_count ?? 0;
  const requestsCount = pending.data?.requests?.length ?? 0;
  const total = sharesCount + requestsCount;
  const hasAny = total > 0;
  // „Nothing new” is a claim about BOTH sources. A source with no data yet
  // (first fetch in flight, or failed with nothing cached) is unknown, and a
  // failed check used to read as a clean inbox. A cached ZERO under a failed
  // poll is unknown as well (TQ v5 keeps the last read on error), since
  // something may have arrived since; a cached positive count stays shown.
  const sharesUnknown = feed === null || (feedError && sharesCount === 0);
  const requestsUnknown =
    pending.data === undefined || (pending.isError && requestsCount === 0);
  const checkFailed =
    (sharesUnknown && feedError) || (requestsUnknown && pending.isError);
  const retryFailed = () => {
    if (sharesUnknown && feedError) {
      void refetchFeed();
    }
    if (requestsUnknown && pending.isError) {
      void pending.refetch();
    }
  };

  return (
    <AppMenuAtom>
      <AppMenuAtom.Trigger
        className={`${styles.bell} haptic-press`}
        aria-label={
          hasAny ? t('ariaLabelWithCount', { count: total }) : t('ariaLabel')
        }>
        <BellIcon size={22} weight={hasAny ? 'fill' : 'regular'} />
        {hasAny && (
          <span className={styles.badge} aria-hidden='true'>
            {total > 9 ? '9+' : total}
          </span>
        )}
      </AppMenuAtom.Trigger>

      <AppMenuAtom.Content align='end' className={styles.menu}>
        <p className={styles.menuTitle}>{t('title')}</p>

        {sharesCount > 0 && (
          <AppMenuAtom.Item
            className={styles.item}
            onClick={() => void router.push(ROUTES_FRONT.SHARED)}>
            <TrayArrowDownIcon
              size={18}
              weight='fill'
              className={styles.itemIcon}
            />
            <span className={styles.itemText}>
              {t('shares', { count: sharesCount })}
            </span>
          </AppMenuAtom.Item>
        )}

        {requestsCount > 0 && (
          <AppMenuAtom.Item
            className={styles.item}
            // Requests are answered on „Twoje klientki”; the QR screen only
            // shows the code (owner 2026-10-09).
            onClick={() => void router.push(ROUTES_FRONT.CLIENTS)}>
            <HandWavingIcon
              size={18}
              weight='fill'
              className={styles.itemIcon}
            />
            <span className={styles.itemText}>
              {t('requests', { count: requestsCount })}
            </span>
          </AppMenuAtom.Item>
        )}

        {checkFailed ? (
          <>
            <p className={styles.empty} role='alert'>
              {t('loadError')}
            </p>
            {/* An item, not a nested button: the menu owns keyboard focus. */}
            <AppMenuAtom.Item className={styles.item} onClick={retryFailed}>
              <span className={styles.itemText}>{t('retry')}</span>
            </AppMenuAtom.Item>
          </>
        ) : (
          !hasAny &&
          !sharesUnknown &&
          !requestsUnknown && <p className={styles.empty}>{t('empty')}</p>
        )}
      </AppMenuAtom.Content>
    </AppMenuAtom>
  );
}
