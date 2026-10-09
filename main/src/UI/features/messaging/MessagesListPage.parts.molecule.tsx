// Inbox filter + conversation row. Extracted so the list composition stays
// under the 300-line ceiling (hide/restore + segmented filter).

import { useTranslations } from 'next-intl';
import { UserIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import type { MessagingConversationDTO } from '@kernel/models/messaging/messaging.dto';
import { buildRoute } from '../../../application/routing/buildRoute';
import { AppLinkAtom } from '../../components/AppLink/AppLink.atom';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import { SegmentedControlMolecule } from '../../components/SegmentedControl/SegmentedControl.molecule';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { AppMenuAtom } from '../../primitives/AppMenu.atom';
import { useMessageWhen } from './hooks/useMessageWhen';
import styles from './MessagesListPage.module.css';

type InboxFilter = 'visible' | 'hidden';

export function InboxFilterMolecule({
  showHidden,
  onShowHiddenChange,
}: {
  showHidden: boolean;
  onShowHiddenChange: (hidden: boolean) => void;
}) {
  const t = useTranslations('pages.messaging');
  return (
    <SegmentedControlMolecule<InboxFilter>
      className={styles.filter}
      size='sm'
      ariaLabel={t('filterLabel')}
      value={showHidden ? 'hidden' : 'visible'}
      onChange={next => onShowHiddenChange(next === 'hidden')}
      options={[
        { value: 'visible', label: t('filterVisible') },
        { value: 'hidden', label: t('filterHidden') },
      ]}
    />
  );
}

/**
 * One conversation: who, then one quiet line with when and what.
 *
 * DECISION (nie usuwaj tego komentarza) — owner 2026-10-08, census S126:
 * the name owns its whole line and may take two („Paulina Dąbrowsk…” was cut
 * by a date column and a menu sharing that line); the date sits in the meta
 * line in front of the preview, which gets two lines. ONE trailing control:
 * the „more” menu. Unread is carried by weight and one dot, whose slot is
 * always mounted so a name does not re-wrap when the conversation is read.
 * The row is a LINK (a route change), not a button.
 */
export function ConversationRowMolecule({
  conversation: c,
  showHidden,
  onHide,
  onRestore,
  actionPending,
}: {
  conversation: MessagingConversationDTO;
  showHidden: boolean;
  onHide: (pairId: string) => void;
  onRestore: (pairId: string) => void;
  actionPending: boolean;
}) {
  const t = useTranslations('pages.messaging');
  const when = useMessageWhen();
  const actionLabel = showHidden
    ? t('restoreConversation')
    : t('hideConversation');
  const showAction = showHidden || c.last_message_at != null;
  const counterpartName = c.counterpart_name.trim();
  const isUnread = c.unread_count > 0;
  const whenLabel = when(c.last_message_at);
  const preview = c.last_message_preview?.trim() ?? '';

  return (
    <div
      className={styles.rowShell}
      data-unread={isUnread ? 'true' : undefined}>
      <AppLinkAtom
        className={styles.row}
        href={buildRoute(ROUTES_FRONT.MESSAGES_THREAD, { pairId: c.pair_id })}>
        {counterpartName.length > 0 ? (
          <AvatarAtom
            src={c.counterpart_avatar_url ?? undefined}
            name={counterpartName}
            size='md'
            decorative
          />
        ) : (
          <span className={styles.neutralAvatar} aria-hidden='true'>
            <UserIcon size={18} />
          </span>
        )}
        <span className={styles.rowMain}>
          <span className={styles.nameLine}>
            <span className={styles.name}>
              {counterpartName || t('unnamedPerson')}
            </span>
            <span className={styles.unreadSlot} aria-hidden='true'>
              {isUnread && <span className={styles.unreadDot} />}
            </span>
          </span>
          <span className={styles.meta} data-truncate='content'>
            {whenLabel.length > 0 && (
              <span className={styles.when}>{whenLabel}</span>
            )}
            {preview.length > 0 ? preview : t('emptyThreadTitle')}
          </span>
          {isUnread && (
            <span className={styles.srOnly}>
              {c.unread_count} {t('heroMetaUnread', { count: c.unread_count })}
            </span>
          )}
        </span>
      </AppLinkAtom>
      {showAction && (
        <AppMenuAtom>
          <AppMenuAtom.MoreTrigger
            className={styles.rowMenu}
            disabled={actionPending}
            label={t('rowMenu')}
          />
          <AppMenuAtom.Content align='end'>
            <AppMenuAtom.Item
              disabled={actionPending}
              onClick={() =>
                showHidden ? onRestore(c.pair_id) : onHide(c.pair_id)
              }>
              {actionLabel}
            </AppMenuAtom.Item>
          </AppMenuAtom.Content>
        </AppMenuAtom>
      )}
    </div>
  );
}

/** Loading state in the geometry of the list: avatar, name, two meta lines. */
export function ConversationListSkeletonMolecule({ label }: { label: string }) {
  return (
    <ul className={styles.list} aria-busy='true' aria-label={label}>
      {[0, 1, 2, 3].map(i => (
        <li key={i} className={styles.skeletonRow}>
          <SkeletonAtom variant='circle' width={40} height={40} />
          <span className={styles.skeletonLines}>
            <SkeletonAtom variant='text' width='46%' height={18} />
            <SkeletonAtom variant='text' width='92%' height={14} />
            <SkeletonAtom variant='text' width='64%' height={14} />
          </span>
        </li>
      ))}
    </ul>
  );
}
