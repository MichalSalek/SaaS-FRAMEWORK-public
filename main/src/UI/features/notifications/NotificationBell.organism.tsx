import { useTranslations } from 'next-intl';
import { BellIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { AppLinkAtom } from '../../components/AppLink/AppLink.atom';
import { usePushController } from '../../../domain/notifications/push/push.controller';
import { useUnreadNotificationsCount } from './hooks/useNotifications';
import styles from './NotificationBell.module.css';

export function NotificationBellOrganism() {
  const t = useTranslations('notifications');
  const { count } = useUnreadNotificationsCount();
  // DECISION: the push controller (sync of a
  // held subscription, push and tap listeners) lives here because the bell is
  // mounted on exactly the screens and for exactly the people pushes concern:
  // every /app screen, signed in, account active (AppLayout's gate). It never
  // prompts; the prompt belongs to PushOptInOrganism.
  usePushController(true);
  const unread = count ?? 0;
  const hasAny = unread > 0;

  return (
    <AppLinkAtom
      href={ROUTES_FRONT.NOTIFICATIONS}
      className={`${styles.bell} press-feedback`}
      aria-label={
        hasAny ? t('ariaLabelWithCount', { count: unread }) : t('ariaLabel')
      }>
      <BellIcon size={22} weight={hasAny ? 'fill' : 'regular'} />
      {hasAny && (
        <span className={styles.badge} aria-hidden='true'>
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </AppLinkAtom>
  );
}
