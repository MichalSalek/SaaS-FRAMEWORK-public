// UI/features/support/SupportThreadListPage.interactive.tsx
// The one row of the help hub that reads data: „Twoje zgłoszenia” (thread
// count + unread replies).

import { useTranslations } from 'next-intl';
import { TrayIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { NavRowMolecule } from '../../components/NavRow/NavRow.molecule';
import {
  useSupportThreads,
  flattenThreadPages,
} from './hooks/useSupportThreads';
import { useSupportUnreadCount } from './hooks/useSupportUnreadCount';

export function ThreadsEntryRowOrganism() {
  const t = useTranslations('pages.support');
  const { data, hasNextPage } = useSupportThreads();
  const { data: unread } = useSupportUnreadCount();

  const threadCount = flattenThreadPages(data).length;
  // A number is stated only for a list that is loaded AND complete: with more
  // pages behind the cursor the loaded length is a lower bound, and with no
  // data at all (still loading, or a failed read) „0 zgłoszeń” would be a lie.
  // Both show a line without a number, so the row keeps its height while the
  // count arrives; the row itself always stays tappable, and the list screen
  // shows the error with a retry.
  const countKnown = data !== undefined && hasNextPage !== true;
  const unreadCount = unread?.unread_threads ?? 0;

  const description = !countKnown
    ? t('threadsEntryFallback')
    : threadCount === 0
      ? t('listEmptyTitle')
      : t('threadsCount', { count: threadCount });

  return (
    <NavRowMolecule
      href={ROUTES_FRONT.SUPPORT_THREADS}
      icon={<TrayIcon size={22} />}
      label={t('listThreadsTitle')}
      description={description}
      badge={{
        count: unreadCount,
        ariaLabel: t('unreadReplies', { count: unreadCount }),
      }}
      trailing='disc'
    />
  );
}
