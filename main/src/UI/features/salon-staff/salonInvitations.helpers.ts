// UI/features/salon-staff/salonInvitations.helpers.ts
// Pure mapping for the invitee screen (/app/salon/invitations): the heading of
// an invitation card, the "sent ..." relative date and the row model that keeps
// an answered invitation on screen as an inline confirmation.

import type { StaffInvitationDTO } from '@kernel/models/salon-staff/salon-staff.dto';
import { formatDate } from '../../../application/date/date.utils';

export type InvitationStatus = 'ACCEPTED' | 'DECLINED';
export type InvitationAnswer = 'ACCEPT' | 'DECLINE';

export interface InvitationHeading {
  /** Name the salon goes by; null when the salon has none set. */
  title: string | null;
  /** The business name under the title, only when it adds information. */
  subtitle: string | null;
}

/** inviter_name is already the backend's best name (display, user, business). */
export function resolveInvitationHeading(
  invitation: Pick<StaffInvitationDTO, 'inviter_name' | 'salon_name'>
): InvitationHeading {
  const inviter = invitation.inviter_name.trim();
  const salon = invitation.salon_name?.trim() ?? '';
  const title = inviter || salon || null;
  const subtitle = salon !== '' && salon !== title ? salon : null;
  return { title, subtitle };
}

const DAY_MS = 86_400_000;

/**
 * "today" / "yesterday" / "3 days ago" / "2 weeks ago" in the app locale
 * (Intl.RelativeTimeFormat, numeric 'auto'), a calendar date from 30 days on.
 * Day granularity: the question on this screen is how long the salon has been
 * waiting, not the minute it wrote.
 */
export function formatInvitedAgo(
  invitedAt: string,
  now: Date,
  locale: string
): string {
  const sent = new Date(invitedAt);
  if (Number.isNaN(sent.getTime())) {
    return '';
  }
  const days = Math.max(
    0,
    Math.floor((now.getTime() - sent.getTime()) / DAY_MS)
  );
  if (days >= 30) {
    return formatDate(sent, locale, '');
  }
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  return days >= 7
    ? rtf.format(-Math.floor(days / 7), 'week')
    : rtf.format(-days, 'day');
}

export type InvitationRow =
  | { kind: 'pending'; invitation: StaffInvitationDTO; hasError: boolean }
  | {
      kind: 'resolved';
      invitation: StaffInvitationDTO;
      status: InvitationStatus;
    }
  | { kind: 'gone'; invitation: StaffInvitationDTO };

export interface FailedAnswer {
  invitation: StaffInvitationDTO;
  response: InvitationAnswer;
}

/**
 * Rows of the screen, oldest invitation first (the backend order).
 *
 * An answered invitation disappears from the server list on the next refetch,
 * but it stays here as a `resolved` row, so the confirmation sits exactly where
 * the card was. A failed answer keeps its card with an inline error while the
 * invitation still exists; once a refetch shows it is gone (withdrawn by the
 * salon meanwhile) the row says so instead of offering a retry that can never
 * land. While that refetch is in flight the card stays as it was.
 */
export function buildInvitationRows({
  pending,
  resolved,
  failed,
  isRefreshing,
}: {
  pending: readonly StaffInvitationDTO[];
  resolved: Readonly<
    Record<string, { invitation: StaffInvitationDTO; status: InvitationStatus }>
  >;
  failed: FailedAnswer | null;
  isRefreshing: boolean;
}): InvitationRow[] {
  const rows: InvitationRow[] = [];
  const pendingIds = new Set<string>();

  for (const invitation of pending) {
    pendingIds.add(invitation.staff_member_id);
    // Explicit `| undefined`: a Record index read is typed as always present.
    const answer:
      { invitation: StaffInvitationDTO; status: InvitationStatus } | undefined =
      resolved[invitation.staff_member_id];
    rows.push(
      answer !== undefined
        ? { kind: 'resolved', invitation, status: answer.status }
        : {
            kind: 'pending',
            invitation,
            hasError:
              failed?.invitation.staff_member_id === invitation.staff_member_id,
          }
    );
  }

  for (const answer of Object.values(resolved)) {
    if (!pendingIds.has(answer.invitation.staff_member_id)) {
      rows.push({
        kind: 'resolved',
        invitation: answer.invitation,
        status: answer.status,
      });
    }
  }

  if (failed) {
    const id = failed.invitation.staff_member_id;
    if (!pendingIds.has(id) && resolved[id] === undefined) {
      rows.push(
        isRefreshing
          ? { kind: 'pending', invitation: failed.invitation, hasError: true }
          : { kind: 'gone', invitation: failed.invitation }
      );
    }
  }

  return rows.sort(
    (a, b) =>
      a.invitation.invited_at.localeCompare(b.invitation.invited_at) ||
      a.invitation.staff_member_id.localeCompare(b.invitation.staff_member_id)
  );
}
