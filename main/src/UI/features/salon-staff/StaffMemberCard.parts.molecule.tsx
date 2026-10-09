// UI/features/salon-staff/StaffMemberCard.parts.molecule.tsx
// Phantom-seat card (D1): dead-user identity is masked; one action frees the slot.
// Remove-only card: plan without staff accounts, one action removes the person.
// Both carry ONE labelled outlined action; the confirmation dialog follows.

import { useTranslations } from 'next-intl';
import type { StaffMemberDTO } from '@kernel/models/salon-staff/salon-staff.dto';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { isPendingInvite } from './salonStaffDisplay.helpers';
import styles from './SalonStaffPage.module.css';

interface StaffMemberInactiveCardProps {
  roleLabel: string;
  onRemove: () => void;
  isRemovePending: boolean;
}

export function StaffMemberInactiveCardMolecule({
  roleLabel,
  onRemove,
  isRemovePending,
}: StaffMemberInactiveCardProps) {
  const t = useTranslations('salon.staff');
  const inactiveName = t('inactiveAccount');

  return (
    <li className={styles.staffCard}>
      <div className={styles.cardRow}>
        <AvatarAtom name={inactiveName} size='md' decorative />
        <div className={styles.cardIdentity}>
          <h2 className={styles.cardName}>{inactiveName}</h2>
          <p className={styles.cardMeta}>{roleLabel}</p>
        </div>
      </div>
      <p className={styles.cardNote}>{t('inactiveAccountHint')}</p>
      <ButtonAtom
        variant='outlined'
        size='sm'
        className={styles.cardAction}
        onClick={onRemove}
        disabled={isRemovePending}>
        {t('freeSlotBtn')}
      </ButtonAtom>
    </li>
  );
}

interface StaffMemberRemoveOnlyCardProps {
  member: StaffMemberDTO;
  displayName: string;
  avatarSrc: string;
  onRemove: (memberId: string) => void;
  isRemovePending: boolean;
}

/** Leftover team after a downgrade: identity, status and removal, nothing else
 *  (no permissions, no detail, no seat language). */
export function StaffMemberRemoveOnlyCardMolecule({
  member,
  displayName,
  avatarSrc,
  onRemove,
  isRemovePending,
}: StaffMemberRemoveOnlyCardProps) {
  const t = useTranslations('salon.staff');
  // The title of a pending or unnamed row already IS the e-mail.
  const email = member.user_inactive ? null : member.user?.email || null;
  const emailText = email !== null && email !== displayName ? email : null;
  const metaLine = isPendingInvite(member) ? t('memberCardPending') : emailText;

  return (
    <li className={styles.staffCard}>
      <div className={styles.cardRow}>
        <AvatarAtom src={avatarSrc} name={displayName} size='md' decorative />
        <div className={styles.cardIdentity}>
          <h3 className={styles.cardName}>{displayName}</h3>
          {metaLine !== null && <p className={styles.cardMeta}>{metaLine}</p>}
        </div>
      </div>
      <ButtonAtom
        variant='outlined'
        size='sm'
        className={styles.cardAction}
        onClick={() => onRemove(member.id)}
        disabled={isRemovePending}
        ariaLabel={`${t('memberCardRemove')}: ${displayName}`}>
        {t('memberCardRemove')}
      </ButtonAtom>
    </li>
  );
}
