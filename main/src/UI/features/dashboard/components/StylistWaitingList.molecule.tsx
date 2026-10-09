// UI/features/dashboard/components/StylistWaitingList.molecule.tsx
// What WAITS for the stylist, at the very top of her dashboard: inspiration
// sessions shared by clients and unread messages.
//
// DECISION (nie usuwaj tego komentarza) — owner 2026-10-08: things that wait
// for her come before things that merely exist, above the main action. The
// sessions row is the stylist's only in-app signal for a shared session (she
// has no sessions tab; a SHARED session expires after 7 days), so it shows
// whenever at least one is pending. Rows, not a card with its own filled
// button: the one filled control of the screen is the stage action below.

import { useTranslations } from 'next-intl';
import { ChatsCircleIcon, TrayArrowDownIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../../components/NavRow/NavRow.molecule';

export function StylistWaitingListMolecule({
  pendingShares,
  unreadMessages,
}: {
  pendingShares: number;
  unreadMessages: number;
}) {
  const t = useTranslations('dashboard.stylist');

  if (pendingShares < 1 && unreadMessages < 1) {
    return null;
  }

  return (
    <NavRowListMolecule label={t('waitingLabel')}>
      {pendingShares >= 1 && (
        <NavRowMolecule
          href={ROUTES_FRONT.SHARED}
          icon={<TrayArrowDownIcon />}
          label={t('sharedInbox.title', { count: pendingShares })}
          description={t('sharedInbox.hint')}
          trailing='disc'
        />
      )}
      {unreadMessages >= 1 && (
        <StylistMessagesRowMolecule unreadMessages={unreadMessages} />
      )}
    </NavRowListMolecule>
  );
}

/** The messages entry: in the waiting list while something is unread, among
 *  the shortcuts otherwise. One row, so both places read the same. */
export function StylistMessagesRowMolecule({
  unreadMessages,
}: {
  unreadMessages: number;
}) {
  const t = useTranslations('dashboard.stylist');
  return (
    <NavRowMolecule
      href={ROUTES_FRONT.MESSAGES}
      icon={<ChatsCircleIcon />}
      label={t('messages')}
      description={t('messagesHint')}
      badge={{
        count: unreadMessages,
        ariaLabel: t('pairsStripUnread', { count: unreadMessages }),
      }}
      trailing='disc'
    />
  );
}
