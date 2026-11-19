// UI/features/notifications/NotificationsPage.composition.tsx
// Centrum powiadomień (/app/notifications, notifications v2): the newest rows
// of the signed-in person in her ACTIVE role, newest first. Opening the screen
// marks what it shows as read and refreshes the bell from the server; every row leads
// to the screen the event happened on. Both roles, phone and desktop (an
// account route: a push tapped on a laptop lands here, not on /get-app).
//
// Feedback: reads stay silent (error-feedback.policy), the screen renders its
// own error with a retry; the read marker is silent too (Style Policy 46).

import { useEffect, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { BellIcon } from '@phosphor-icons/react';
import { renderNotificationCopy } from '@kernel/domain/notifications/notification-copy.config';
import { getLocaleOrDefault } from '@kernel/domain/i18n/i18n.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  NotificationTypeValue,
  type NotificationDTO,
} from '@kernel/models/notifications/notifications.dto';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import {
  NavRowListMolecule,
  NavRowListSkeletonMolecule,
  NavRowMolecule,
} from '../../components/NavRow/NavRow.molecule';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import { useAuth } from '../../contexts/AuthContext.composition';
import { PushOptInOrganism } from '../shared/push/PushOptIn.organism';
import { trackFlowStep } from '../../../application/analytics/flow-events';
import { AnnouncementNotificationRowOrganism } from '../announcements/AnnouncementNotificationRow.organism';
import { notificationAnnouncementView } from '../announcements/announcement-display';
import { useRecentNotifications } from './hooks/useNotifications';
import { useNotificationReadMarker } from './hooks/useNotificationReadMarker';
import {
  NOTIFICATION_ICONS,
  formatNotificationTime,
} from './notificationPresentation';
import styles from './NotificationsPage.module.css';

function NotificationRow({
  notification,
  now,
  locale,
}: {
  notification: NotificationDTO;
  now: Date;
  locale: string;
}) {
  const Icon = NOTIFICATION_ICONS[notification.type];
  const unread = notification.read_at === null;
  const copy = renderNotificationCopy(
    getLocaleOrDefault(locale),
    notification.type,
    notification.actor_name,
    notification
  );
  return (
    <NavRowMolecule
      href={`${ROUTES_FRONT.NOTIFICATION_OPEN}?id=${encodeURIComponent(notification.id)}`}
      icon={<Icon size={20} weight={unread ? 'fill' : 'regular'} />}
      label={copy.title}
      description={formatNotificationTime(notification.created_at, now, locale)}
      trailing='disc'
      unread={unread}
      onClick={() => {
        trackFlowStep('notifications', 'row_opened', {
          type: notification.type,
          unread,
        });
      }}
    />
  );
}

function NotificationsPageInner() {
  const t = useTranslations('notifications');
  const tButtons = useTranslations('buttons');
  const locale = useLocale();
  useAppBarTitle(t('title'));
  const { isLoggedIn } = useAuth();
  const query = useRecentNotifications(isLoggedIn);
  // Read once per render: the rows need minute precision at most.
  const now = new Date();

  // One marker per fetched snapshot: the newest row the screen holds bounds
  // what counts as seen, so a row arriving after this fetch stays new.
  const newestSeenAt = query.data?.notifications[0]?.created_at ?? null;
  const unread = query.data?.unread_count ?? 0;
  useNotificationReadMarker({
    newestSeenAt,
    unread,
    dataUpdatedAt: query.dataUpdatedAt,
  });

  const openedTracked = useRef(false);
  useEffect(() => {
    if (query.data === undefined || openedTracked.current) {
      return;
    }
    openedTracked.current = true;
    trackFlowStep('notifications', 'opened', {
      unread: query.data.unread_count,
      total: query.data.notifications.length,
    });
  }, [query.data]);

  const renderBody = () => {
    // Error only without data: a failed background refetch keeps the list.
    if (query.isError && query.data === undefined) {
      return (
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={tButtons('retry')}
          onRetry={() => void query.refetch()}
          isRetrying={query.isFetching}
        />
      );
    }
    if (query.data === undefined) {
      return <NavRowListSkeletonMolecule rows={4} lines={2} />;
    }
    if (query.data.notifications.length === 0) {
      return (
        <EmptyStateAtom
          size='page'
          icon={<BellIcon size={40} weight='regular' />}
          title={t('emptyTitle')}
          titleAs='h2'
          description={t('emptyBody')}
          lang={locale}
          role='status'
        />
      );
    }
    return (
      <NavRowListMolecule ariaLabel={t('listAriaLabel')}>
        {query.data.notifications.map(notification => {
          const announcementView =
            notification.type === NotificationTypeValue.SYSTEM_ANNOUNCEMENT
              ? notificationAnnouncementView(
                  notification.announcement,
                  getLocaleOrDefault(locale)
                )
              : null;
          if (announcementView !== null) {
            return (
              <AnnouncementNotificationRowOrganism
                key={notification.id}
                notification={notification}
                now={now}
              />
            );
          }
          return (
            <NotificationRow
              key={notification.id}
              notification={notification}
              now={now}
              locale={locale}
            />
          );
        })}
      </NavRowListMolecule>
    );
  };

  return (
    <div className={styles.page} lang={locale}>
      <AppHeroOrganism
        title={t('title')}
        {...(unread > 0
          ? { meta: <span>{t('heroMetaUnread', { count: unread })}</span> }
          : {})}
      />
      <PageColumnsMolecule
        main={
          <>
            {/* The device switch stands above the list only while it can
                still be switched on; the account settings keep it always. */}
            <section className={styles.optIn}>
              <PushOptInOrganism onlyWhenOff />
            </section>
            {renderBody()}
          </>
        }
      />
    </div>
  );
}

export function NotificationsPageComposition() {
  const t = useTranslations('notifications');
  return (
    <AppLayoutComposition title={t('title')}>
      <NotificationsPageInner />
    </AppLayoutComposition>
  );
}
