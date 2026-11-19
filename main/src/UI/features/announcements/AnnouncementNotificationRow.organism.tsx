// announcements/AnnouncementNotificationRow.organism.tsx
// A bell row whose body can hold several links. The row itself is an anchor
// only when the body has none, so anchors are never nested.

import { useLocale, useTranslations } from 'next-intl';
import { getLocaleOrDefault } from '@kernel/domain/i18n/i18n.config';
import {
  NotificationTypeValue,
  type NotificationDTO,
} from '@kernel/models/notifications/notifications.dto';
import { trackFlowStep } from '../../../application/analytics/flow-events';
import { AffordanceDiscAtom } from '../../components/AffordanceDisc/AffordanceDisc.atom';
import { AppLinkAtom } from '../../components/AppLink/AppLink.atom';
import { ExternalLinkAtom } from '../../components/ExternalLink/ExternalLink.atom';
import { StatusPillAtom } from '../../components/StatusPill/StatusPill.atom';
import { AnnouncementContentMolecule } from './AnnouncementContent.molecule';
import { notificationAnnouncementView } from './announcement-display';
import {
  NOTIFICATION_ICONS,
  formatNotificationTime,
} from '../notifications/notificationPresentation';
import styles from './AnnouncementNotificationRow.module.css';

interface AnnouncementNotificationRowProps {
  notification: NotificationDTO;
  now: Date;
}

export function AnnouncementNotificationRowOrganism({
  notification,
  now,
}: AnnouncementNotificationRowProps) {
  const locale = getLocaleOrDefault(useLocale());
  const t = useTranslations('notifications');
  const view = notificationAnnouncementView(notification.announcement, locale);
  if (view === null) {
    return null;
  }
  const Icon = NOTIFICATION_ICONS.SYSTEM_ANNOUNCEMENT;
  const unread = notification.read_at === null;
  const isTest =
    notification.type === NotificationTypeValue.SYSTEM_ANNOUNCEMENT &&
    notification.announcement?.test_locale != null;
  const time = formatNotificationTime(notification.created_at, now, locale);
  const track = () => {
    trackFlowStep('notifications', 'row_opened', {
      type: notification.type,
      unread,
    });
  };
  const body = (
    <>
      <span className={styles.icon} aria-hidden='true'>
        <Icon size={20} weight={unread ? 'fill' : 'regular'} />
      </span>
      <span className={styles.body}>
        <span className={styles.title} lang={view.locale}>
          {view.title}
        </span>
        {isTest && (
          <span>
            <StatusPillAtom
              label={t('testLabel')}
              color='var(--color-text-secondary)'
              showDot={false}
            />
          </span>
        )}
        <span lang={view.locale}>
          <AnnouncementContentMolecule
            message={view.message}
            className={styles.message}
            onInternalOpen={track}
          />
        </span>
        {time.length > 0 && <span className={styles.time}>{time}</span>}
      </span>
      {view.rowHref !== null && <AffordanceDiscAtom size='md' />}
    </>
  );
  const look = unread ? { 'data-unread': 'true' as const } : {};
  let row;
  if (view.rowHref === null) {
    row = (
      <div className={styles.row} {...look}>
        {body}
      </div>
    );
  } else if (view.external) {
    row = (
      <ExternalLinkAtom href={view.rowHref} className={styles.row} {...look}>
        {body}
      </ExternalLinkAtom>
    );
  } else {
    row = (
      <AppLinkAtom
        href={view.rowHref}
        className={styles.row}
        {...look}
        onClick={track}>
        {body}
      </AppLinkAtom>
    );
  }
  return <li className={styles.item}>{row}</li>;
}
