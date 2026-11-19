// domain/admin/operations/admin-user-list-stats.ts
// Per-row figures of the admin users list (kernel AdminUserListStats), for the
// rows of ONE page. Every figure is one batched query over the page's ids, so
// the cost is a fixed number of queries per page, never one per row.
// What is counted and why: DECISION on AdminUserListStats (kernel admin-users.dto.ts).

import { DB_CLIENT } from '@app/db/db.client';
import type {
  AdminUserListStats,
  AdminUserTeamRole,
} from '@kernel/models/admin/admin-users.dto';
import {
  PairingStatusValue,
  StylistClientMessageSenderValue,
} from '@kernel/models/db_models.generated.dto';

/** What the list query already knows about a row and the stats need. */
export type AdminUserStatsSource = {
  id: string;
  notifications_enabled: boolean;
  stylist_account: {
    account_id: string;
    address_city: string | null;
    email_marketing: boolean;
  } | null;
  client_account: { client_account_id: string } | null;
};

type Counts = Map<string, number>;

const countsBy = <K extends string>(
  rows: readonly ({ _count: { _all: number } } & Record<K, string | null>)[],
  key: K
): Counts => {
  const counts: Counts = new Map();
  for (const row of rows) {
    const id = row[key];
    if (id !== null) {
      counts.set(id, (counts.get(id) ?? 0) + row._count._all);
    }
  }
  return counts;
};

const add = (counts: Counts, key: string, amount: number): void => {
  counts.set(key, (counts.get(key) ?? 0) + amount);
};

export const fetchAdminUserListStats = async (
  rows: readonly AdminUserStatsSource[]
): Promise<Map<string, AdminUserListStats>> => {
  if (rows.length === 0) {
    return new Map();
  }

  const userIds = rows.map(row => row.id);
  const stylistIds = rows.flatMap(row =>
    row.stylist_account ? [row.stylist_account.account_id] : []
  );
  const clientIds = rows.flatMap(row =>
    row.client_account ? [row.client_account.client_account_id] : []
  );
  const db = DB_CLIENT.use;

  const [
    photos,
    publicWorks,
    pairs,
    sessionsAsClient,
    sessionsAsStylist,
    supportThreads,
    pushDevices,
    teamRows,
  ] = await Promise.all([
    db.galleryRecord.groupBy({
      by: ['created_by_account_id'],
      where: { created_by_account_id: { in: stylistIds } },
      _count: { _all: true },
    }),
    db.galleryRecord.groupBy({
      by: ['created_by_account_id'],
      where: {
        created_by_account_id: { in: stylistIds },
        is_pinned: true,
        is_hidden: false,
      },
      _count: { _all: true },
    }),
    // Every pair of the page on either side: the ACTIVE ones are the
    // connections, all of them carry messages (a REVOKED pair keeps history).
    db.clientStylistPair.findMany({
      where: {
        OR: [
          { client_user_id: { in: userIds } },
          { stylist_account_id: { in: stylistIds } },
        ],
      },
      select: {
        id: true,
        client_user_id: true,
        stylist_account_id: true,
        status: true,
      },
    }),
    db.sessionContainer.groupBy({
      by: ['client_account_id'],
      where: { client_account_id: { in: clientIds } },
      _count: { _all: true },
    }),
    db.sessionContainer.groupBy({
      by: ['stylist_account_id'],
      where: { stylist_account_id: { in: stylistIds } },
      _count: { _all: true },
    }),
    db.supportThread.groupBy({
      by: ['user_id'],
      where: { user_id: { in: userIds } },
      _count: { _all: true },
    }),
    db.pushSubscription.groupBy({
      by: ['user_id'],
      where: { user_id: { in: userIds }, failed_at: null },
      _count: { _all: true },
    }),
    db.staffMember.findMany({
      where: {
        is_active: true,
        accepted_at: { not: null },
        OR: [
          { user_id: { in: userIds } },
          { stylist_account_id: { in: stylistIds } },
        ],
      },
      select: { user_id: true, stylist_account_id: true },
    }),
  ]);

  const messages =
    pairs.length === 0
      ? []
      : await db.stylistClientMessage.groupBy({
          by: ['pair_id', 'sender_type'],
          where: { pair_id: { in: pairs.map(pair => pair.id) } },
          _count: { _all: true },
        });

  const userIdByStylistId = new Map(
    rows.flatMap(row =>
      row.stylist_account ? [[row.stylist_account.account_id, row.id]] : []
    )
  );
  const pageUserIds = new Set(userIds);

  const connections: Counts = new Map();
  const pairById = new Map(pairs.map(pair => [pair.id, pair] as const));
  for (const pair of pairs) {
    if (pair.status !== PairingStatusValue.ACTIVE) {
      continue;
    }
    if (pageUserIds.has(pair.client_user_id)) {
      add(connections, pair.client_user_id, 1);
    }
    const stylistUserId = userIdByStylistId.get(pair.stylist_account_id);
    if (stylistUserId !== undefined) {
      add(connections, stylistUserId, 1);
    }
  }

  const messagesSent: Counts = new Map();
  for (const group of messages) {
    const pair = pairById.get(group.pair_id);
    if (pair === undefined) {
      continue;
    }
    const senderUserId =
      group.sender_type === StylistClientMessageSenderValue.CLIENT
        ? pageUserIds.has(pair.client_user_id)
          ? pair.client_user_id
          : undefined
        : userIdByStylistId.get(pair.stylist_account_id);
    if (senderUserId !== undefined) {
      add(messagesSent, senderUserId, group._count._all);
    }
  }

  const ownerStylistIds = new Set<string>();
  const memberUserIds = new Set<string>();
  for (const member of teamRows) {
    const ownerUserId = userIdByStylistId.get(member.stylist_account_id);
    if (ownerUserId !== undefined && ownerUserId !== member.user_id) {
      ownerStylistIds.add(member.stylist_account_id);
    }
    if (pageUserIds.has(member.user_id) && ownerUserId !== member.user_id) {
      memberUserIds.add(member.user_id);
    }
  }

  const photosByStylist = countsBy(photos, 'created_by_account_id');
  const publicByStylist = countsBy(publicWorks, 'created_by_account_id');
  const sessionsByClient = countsBy(sessionsAsClient, 'client_account_id');
  const sessionsByStylist = countsBy(sessionsAsStylist, 'stylist_account_id');
  const threadsByUser = countsBy(supportThreads, 'user_id');
  const devicesByUser = countsBy(pushDevices, 'user_id');

  return new Map(
    rows.map(row => {
      const stylist = row.stylist_account;
      const client = row.client_account;
      const teamRole: AdminUserTeamRole | null =
        stylist !== null && ownerStylistIds.has(stylist.account_id)
          ? 'OWNER'
          : memberUserIds.has(row.id)
            ? 'MEMBER'
            : null;
      const stats: AdminUserListStats = {
        photos: stylist ? (photosByStylist.get(stylist.account_id) ?? 0) : null,
        public_works: stylist
          ? (publicByStylist.get(stylist.account_id) ?? 0)
          : null,
        connections: connections.get(row.id) ?? 0,
        inspiration_sessions:
          (client ? (sessionsByClient.get(client.client_account_id) ?? 0) : 0) +
          (stylist ? (sessionsByStylist.get(stylist.account_id) ?? 0) : 0),
        messages_sent: messagesSent.get(row.id) ?? 0,
        support_threads: threadsByUser.get(row.id) ?? 0,
        push_devices: devicesByUser.get(row.id) ?? 0,
        city: stylist?.address_city?.trim() || null,
        team_role: teamRole,
        notifications_enabled: row.notifications_enabled,
        email_marketing: stylist ? stylist.email_marketing : null,
      };
      return [row.id, stats] as const;
    })
  );
};
