// UI/features/salon-staff/StaffMemberPermissions.molecule.tsx
// Permission assignment of one team member: a disclosure with one switch per
// permission; the owner gets a single „all permissions” line instead.
//
// Hidden scaffold: StaffMemberCard mounts it only behind
// SHOW_STAFF_PERMISSION_CONTROLS (DECISION there). Stored permissions do not
// grant access yet, so the product does not show this panel today.

import { useTranslations } from 'next-intl';
import type { StaffPermission } from '@kernel/domain/user-and-account/staff_accounts.config';
import type { StaffMemberDTO } from '@kernel/models/salon-staff/salon-staff.dto';
import { DisclosureMolecule } from '../../components/Disclosure/Disclosure.molecule';
import { ToggleAtom } from '../../components/Toggle/Toggle.atom';
import styles from './SalonStaffPage.module.css';

interface StaffMemberPermissionsProps {
  member: StaffMemberDTO;
  isOwner: boolean;
  permissionKeys: readonly StaffPermission[];
  permissionLabels: Record<StaffPermission, string>;
  onTogglePermission: (member: StaffMemberDTO, perm: StaffPermission) => void;
}

export function StaffMemberPermissionsMolecule({
  member,
  isOwner,
  permissionKeys,
  permissionLabels,
  onTogglePermission,
}: StaffMemberPermissionsProps) {
  const t = useTranslations('salon.staff');

  if (isOwner) {
    return <p className={styles.permsOwner}>{t('memberCardOwnerBadge')}</p>;
  }

  const activeCount = permissionKeys.filter(p =>
    member.permissions.includes(p)
  ).length;

  return (
    <DisclosureMolecule
      surface='plain'
      headingAs='h3'
      title={t('memberCardPermissionsTitle')}
      summary={t('memberCardPermissionsCount', { count: activeCount })}>
      <ul className={styles.permsList}>
        {permissionKeys.map(perm => (
          <li key={perm} className={styles.permRow}>
            <span className={styles.permRowText}>{permissionLabels[perm]}</span>
            {/* The visible label is a sibling span, not the <label> of the
                switch, so without aria-label a screen reader announced
                four identical unnamed switches. */}
            <ToggleAtom
              checked={member.permissions.includes(perm)}
              onChange={() => onTogglePermission(member, perm)}
              aria-label={permissionLabels[perm]}
            />
          </li>
        ))}
      </ul>
    </DisclosureMolecule>
  );
}
