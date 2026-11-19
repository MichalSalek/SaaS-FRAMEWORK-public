// UI/features/salon-staff/SalonStaffDetailDialog.composition.tsx
// Read-only details of one team member, opened from the card's „more” menu.
// A pending invitation also says what happens next. The dialog closes with its
// own close button (it has no action of its own).

import { useLocale, useTranslations } from 'next-intl';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { AppDialogAtom } from '../../primitives/AppDialog.atom';
import { formatDateLong } from '../../../application/date/date.utils';
import { useSalonStaffById } from './hooks/useSalonStaffById';
import { isPendingInvite } from './salonStaffDisplay.helpers';
import styles from './SalonStaffPage.module.css';

interface SalonStaffDetailDialogProps {
  staffId: string | null;
  onClose: () => void;
}

export function SalonStaffDetailDialogComposition({
  staffId,
  onClose,
}: SalonStaffDetailDialogProps) {
  const t = useTranslations('salon.staff');
  const tRoles = useTranslations('salon.roles');
  const tButtons = useTranslations('buttons');
  // App locale, not the browser's: an EN/DE UI on a Polish device printed the
  // date in Polish.
  const locale = useLocale();
  const { staff, isLoading, isError, isFetching, refetch } =
    useSalonStaffById(staffId);

  // „Dołączyła” is the ACCEPTANCE moment; a pending invite has none
  // (created_at is the invitation, which the status row already covers).
  const joinedDateLabel = staff?.accepted_at
    ? formatDateLong(staff.accepted_at, locale, '')
    : '';
  const isPending = staff !== null && isPendingInvite(staff);

  return (
    <AppDialogAtom
      open={staffId !== null}
      onOpenChange={open => {
        if (!open) {
          onClose();
        }
      }}>
      <AppDialogAtom.Content title={t('detailDialogTitle')}>
        <div className={styles.dialogBody}>
          {isLoading && (
            // Three rows, the usual size of the list below.
            <div className={styles.detailSkeleton} aria-busy='true'>
              <SkeletonAtom variant='text' width='70%' height={18} />
              <SkeletonAtom variant='text' width='45%' height={18} />
              <SkeletonAtom variant='text' width='55%' height={18} />
            </div>
          )}

          {/* Error only without a record: a failed background refetch keeps
              the cached member (TQ v5) and must not hide it. */}
          {isError && !isLoading && staff === null && (
            <ErrorStateMolecule
              message={t('detailDialogLoadError')}
              retryLabel={tButtons('retry')}
              onRetry={() => void refetch()}
              isRetrying={isFetching}
            />
          )}

          {!isLoading && staff && (
            <dl className={styles.detailList}>
              {staff.user_inactive ? (
                <div className={styles.detailRow}>
                  <dt className={styles.detailLabel}>{t('inactiveAccount')}</dt>
                  <dd className={styles.detailValue}>
                    {t('inactiveAccountHint')}
                  </dd>
                </div>
              ) : (
                staff.user?.email && (
                  <div className={styles.detailRow}>
                    <dt className={styles.detailLabel}>
                      {t('detailDialogEmailLabel')}
                    </dt>
                    <dd className={styles.detailValue}>{staff.user.email}</dd>
                  </div>
                )
              )}
              <div className={styles.detailRow}>
                <dt className={styles.detailLabel}>
                  {t('detailDialogRoleLabel')}
                </dt>
                {/* Translated label, not the raw enum („EMPLOYEE”). */}
                <dd className={styles.detailValue}>{tRoles(staff.role)}</dd>
              </div>
              <div className={styles.detailRow}>
                <dt className={styles.detailLabel}>
                  {t('detailDialogStatusLabel')}
                </dt>
                <dd className={styles.detailValue}>
                  {isPending
                    ? t('detailDialogStatusPending')
                    : t('detailDialogStatusActive')}
                </dd>
              </div>
              {joinedDateLabel !== '' && (
                <div className={styles.detailRow}>
                  <dt className={styles.detailLabel}>
                    {t('detailDialogJoinedLabel')}
                  </dt>
                  <dd className={styles.detailValue}>{joinedDateLabel}</dd>
                </div>
              )}
            </dl>
          )}

          {!isLoading && isPending && (
            <p className={styles.dialogNote}>{t('pendingHint')}</p>
          )}
        </div>
      </AppDialogAtom.Content>
    </AppDialogAtom>
  );
}
