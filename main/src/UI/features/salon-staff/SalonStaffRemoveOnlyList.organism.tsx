// UI/features/salon-staff/SalonStaffRemoveOnlyList.organism.tsx
// Leftover team on a plan without staff accounts (owner, 2026-09-24): the
// people stay visible and removable, nothing else. No counter in the header:
// "3 / 9" style usage would imply seats the plan does not pay for.

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import type { StaffMemberDTO } from '@kernel/models/salon-staff/salon-staff.dto';
import { getAvatarSrc, getDisplayName } from './salonStaffDisplay.helpers';
import { StaffMemberRemoveOnlyCardMolecule } from './StaffMemberCard.parts.molecule';
import styles from './SalonStaffPage.module.css';

interface SalonStaffRemoveOnlyListProps {
  members: readonly StaffMemberDTO[];
  onRemove: (memberId: string) => void;
  isRemovePending: boolean;
}

export function SalonStaffRemoveOnlyListOrganism({
  members,
  onRemove,
  isRemovePending,
}: SalonStaffRemoveOnlyListProps) {
  const t = useTranslations('salon.staff');
  const titleId = useId();

  return (
    <section className={styles.section} aria-labelledby={titleId}>
      <div className={styles.sectionHead}>
        <h2 id={titleId} className={styles.sectionTitle}>
          {t('lockedRosterTitle')}
        </h2>
        <p className={styles.sectionBody}>{t('lockedRosterBody')}</p>
      </div>
      <ul className={styles.staffGrid}>
        {members.map(member => (
          <StaffMemberRemoveOnlyCardMolecule
            key={member.id}
            member={member}
            displayName={getDisplayName(member, t('inactiveAccount'))}
            avatarSrc={getAvatarSrc(member)}
            onRemove={onRemove}
            isRemovePending={isRemovePending}
          />
        ))}
      </ul>
    </section>
  );
}
