// UI/features/dashboard/components/StylistWaitingList.molecule.tsx
// What WAITS for the stylist, at the very top of her dashboard: inspiration
// connection requests, sessions shared by clients and unread messages.
//
// DECISION: things that wait for her come before things that merely exist, above the main action.
// The sessions row is the stylist's only in-app signal for a shared session (she has no sessions
// tab; a SHARED session expires after SESSION_EXPIRY_DAYS), so it shows whenever at least one is pending. Rows,
// not a card with its own filled button: the one filled control of the screen is the stage action
// below. (owner)

import { useTranslations } from 'next-intl';
import {
  ChatsCircleIcon,
  TrayArrowDownIcon,
  UserPlusIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../../components/NavRow/NavRow.molecule';
import { usePendingRequests } from '../../shared/pairing/hooks/usePairRequests';

export function StylistWaitingListMolecule({
  pendingShares,
  unreadMessages,
}: {
  pendingShares: number;
  unreadMessages: number;
}) {
  const t = useTranslations('dashboard.stylist');
  // A client's request waited behind the bell while the clients section below said „no connected
  // clients yet, show your QR code”. Same query (and cache) as the bell and /app/clients.
  const pendingRequests = usePendingRequests(true).data?.requests.length ?? 0;

  if (pendingRequests < 1 && pendingShares < 1 && unreadMessages < 1) {
    return null;
  }

  return (
    <NavRowListMolecule label={t('waitingLabel')}>
      {pendingRequests >= 1 && (
        <NavRowMolecule
          href={ROUTES_FRONT.CLIENTS}
          icon={<UserPlusIcon />}
          label={t('pairRequests.title', { count: pendingRequests })}
          description={t('pairRequests.hint')}
          trailing='disc'
        />
      )}
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
