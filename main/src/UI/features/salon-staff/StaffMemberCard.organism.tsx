// UI/features/salon-staff/StaffMemberCard.organism.tsx
// One person of the salon team: avatar, name (up to two lines), one quiet meta
// line and ONE trailing control, the „more” menu (details, removal).
//
// DECISION: the card used to end with a strip of two unlabelled 14px icons, the red one a single
// tap from the removal dialog, and wore a role pill that looked like a button. Both actions now sit
// behind one labelled menu, the role is plain quiet text, and removal still goes through the
// confirmation that names the person (SalonStaffDialogs). Do not bring back icon-only actions on
// the card.

import { useLocale, useTranslations } from 'next-intl';
import type { StaffPermission } from '@kernel/domain/user-and-account/staff_accounts.config';
import type { StaffMemberDTO } from '@kernel/models/salon-staff/salon-staff.dto';
import { NavRowMolecule } from '../../components/NavRow/NavRow.molecule';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../application/routing/buildRoute';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import { AppMenuAtom } from '../../primitives/AppMenu.atom';
import { StaffMemberInactiveCardMolecule } from './StaffMemberCard.parts.molecule';
import { StaffMemberPermissionsMolecule } from './StaffMemberPermissions.molecule';
import { formatInvitedAgo } from './salonInvitations.helpers';
import {
  formatJoinedMonth,
  isPendingInvite,
} from './salonStaffDisplay.helpers';
import styles from './SalonStaffPage.module.css';

type PermissionKey = StaffPermission;

// DECISION: Stored permissions do not grant access to private colleague data.
// Membership separately inherits capabilities on the member’s own account. Keep
// the assignment scaffold hidden until its backend access behavior is implemented.
// This presentation gate does not change stored permissions or API contracts.
const SHOW_STAFF_PERMISSION_CONTROLS = false;

interface StaffMemberCardProps {
  member: StaffMemberDTO;
  displayName: string;
  avatarSrc: string;
  roleLabel: string;
  permissionKeys: readonly PermissionKey[];
  permissionLabels: Record<PermissionKey, string>;
  isCurrentUser: boolean;
  onRemove: (memberId: string) => void;
  onTogglePermission: (member: StaffMemberDTO, perm: PermissionKey) => void;
  onViewDetail?: (memberId: string) => void;
  isRemovePending?: boolean;
}

export function StaffMemberCardOrganism({
  member,
  displayName,
  avatarSrc,
  roleLabel,
  permissionKeys,
  permissionLabels,
  isCurrentUser: _isCurrentUser,
  onRemove,
  onTogglePermission,
  onViewDetail,
  isRemovePending = false,
}: StaffMemberCardProps) {
  const t = useTranslations('salon.staff');
  const locale = useLocale();

  if (member.user_inactive) {
    return (
      <StaffMemberInactiveCardMolecule
        roleLabel={roleLabel}
        onRemove={() => onRemove(member.id)}
        isRemovePending={isRemovePending}
      />
    );
  }

  // DECISION: the OWNER-card UI is a post-launch scaffold. No path creates an OWNER StaffMember
  // today (the owner manages the roster, she is not an entry in it), analogous to
  // staffmember-accepted-at-scaffold (SCHEMA_DECISIONS.md). The branch is kept intentionally; do
  // NOT remove it as dead code.
  // analogicznie do staffmember-accepted-at-scaffold (SCHEMA_DECISIONS.md).
  // Gałąź zachowana intencjonalnie, NIE usuwać jako "dead code".
  const isOwner = member.role === 'OWNER';
  const isPending = isPendingInvite(member);

  // One quiet line. Pending: when she was invited and what happens next (until
  // acceptance the backend masks the name, so the title IS the typed e-mail).
  // Accepted: the role and since when; the e-mail lives in the details.
  const invitedAgo = isPending
    ? formatInvitedAgo(member.created_at, new Date(), locale)
    : '';
  const joinedMonth = formatJoinedMonth(member.accepted_at, locale);
  const metaLine = member.awaiting_stylist_account
    ? t('memberCardAwaitingStylist')
    : isPending
      ? invitedAgo !== ''
        ? t('memberMetaPending', { ago: invitedAgo })
        : t('memberCardPending')
      : joinedMonth !== null
        ? t('memberMetaJoined', { role: roleLabel, date: joinedMonth })
        : roleLabel;

  const hasMenu =
    (onViewDetail !== undefined && member.user_id !== '') || !isOwner;

  const menu = hasMenu ? (
    <AppMenuAtom>
      <AppMenuAtom.MoreTrigger
        label={t('memberCardMore', { name: displayName })}
      />
      <AppMenuAtom.Content align='end'>
        {onViewDetail && member.user_id !== '' && (
          <AppMenuAtom.Item onClick={() => onViewDetail(member.id)}>
            {t('memberCardManage')}
          </AppMenuAtom.Item>
        )}
        {!isOwner && (
          <AppMenuAtom.Item
            tone='danger'
            disabled={isRemovePending}
            onClick={() => onRemove(member.id)}>
            {t('memberCardRemove')}
          </AppMenuAtom.Item>
        )}
      </AppMenuAtom.Content>
    </AppMenuAtom>
  ) : undefined;

  // The „more” menu is the row's `end` control (NavRow owns the cell), so it
  // never leaves the card: as a flex sibling of a non-shrinking row it was
  // pushed past the card edge on a phone.
  return (
    <li className={`${styles.staffCard} ${styles.staffCardRow}`}>
      <NavRowMolecule
        label={displayName}
        description={metaLine}
        leading={
          <AvatarAtom src={avatarSrc} name={displayName} size='md' decorative />
        }
        {...(member.public_profile_id
          ? {
              href: buildRoute(ROUTES_FRONT.STYLIST_PROFILE, {
                identifier: member.public_profile_id,
              }),
            }
          : {})}
        note={
          !isPending
            ? t(
                member.contributes_to_gallery === false
                  ? 'galleryOptedOut'
                  : 'galleryContributing'
              )
            : undefined
        }
        trailing='disc'
        {...(menu !== undefined ? { end: menu } : {})}
      />

      {SHOW_STAFF_PERMISSION_CONTROLS && (
        <StaffMemberPermissionsMolecule
          member={member}
          isOwner={isOwner}
          permissionKeys={permissionKeys}
          permissionLabels={permissionLabels}
          onTogglePermission={onTogglePermission}
        />
      )}
    </li>
  );
}
