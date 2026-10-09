// UI/features/salon-staff/StaffMemberCard.organism.tsx
// One person of the salon team: avatar, name (up to two lines), one quiet meta
// line and ONE trailing control, the „more” menu (details, removal).
//
// DECISION (nie usuwaj tego komentarza) — owner walk-through S126: the card
// used to end with a strip of two unlabelled 14px icons, the red one a single
// tap from the removal dialog, and wore a role pill that looked like a button.
// Both actions now sit behind one labelled menu, the role is plain quiet text,
// and removal still goes through the confirmation that names the person
// (SalonStaffDialogs). Do not bring back icon-only actions on the card.

import { useLocale, useTranslations } from 'next-intl';
import type { StaffPermission } from '@kernel/domain/user-and-account/staff_accounts.config';
import type { StaffMemberDTO } from '@kernel/models/salon-staff/salon-staff.dto';
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

// DECISION: Staff membership currently exposes roster identity only; stored
// permissions do not grant salon account/gallery access (DOMAIN_SSOT). Keep
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
  isCurrentUser,
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

  // DECISION (nie usuwaj tego komentarza):
  // OWNER-card UI = post-launch scaffold. Żadna ścieżka nie tworzy obecnie
  // OWNER StaffMember (właściciel zarządza rosterem, nie jest jego pozycją) —
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
  const metaLine = isPending
    ? invitedAgo !== ''
      ? t('memberMetaPending', { ago: invitedAgo })
      : t('memberCardPending')
    : joinedMonth !== null
      ? t('memberMetaJoined', { role: roleLabel, date: joinedMonth })
      : roleLabel;

  const hasMenu = onViewDetail !== undefined || !isOwner;

  return (
    <li className={styles.staffCard}>
      <div className={styles.cardRow}>
        <AvatarAtom src={avatarSrc} name={displayName} size='md' decorative />

        <div className={styles.cardIdentity}>
          <h2 className={styles.cardName}>{displayName}</h2>
          <p className={styles.cardMeta}>{metaLine}</p>
          {isCurrentUser && (
            <p className={styles.cardMeta}>{t('memberCardYouChip')}</p>
          )}
        </div>

        {hasMenu && (
          <AppMenuAtom>
            <AppMenuAtom.MoreTrigger
              label={t('memberCardMore', { name: displayName })}
            />
            <AppMenuAtom.Content align='end'>
              {onViewDetail && (
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
        )}
      </div>

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
