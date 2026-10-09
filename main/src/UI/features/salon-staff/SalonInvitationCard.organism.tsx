// UI/features/salon-staff/SalonInvitationCard.organism.tsx
// One row of the invitee screen (/app/salon/invitations): a pending invitation
// with its two answers, or what is left of it after the answer (an inline
// confirmation in the same slot, or a note that the invitation is gone).

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import {
  CheckCircleIcon,
  InfoIcon,
  WarningCircleIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import type { StaffInvitationDTO } from '@kernel/models/salon-staff/salon-staff.dto';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
import {
  formatInvitedAgo,
  resolveInvitationHeading,
  type InvitationAnswer,
  type InvitationRow,
} from './salonInvitations.helpers';
import styles from './SalonInvitationsPage.module.css';

interface SalonInvitationCardProps {
  row: InvitationRow;
  locale: string;
  now: Date;
  /** This card carries the screen's one filled action. */
  isLead: boolean;
  /** Any answer is in flight: every card is inert until it settles. */
  isBusy: boolean;
  /** The answer in flight belongs to THIS card (drives aria-busy). */
  busyAnswer: InvitationAnswer | null;
  /** The answer that failed on this card, re-sent by the retry button. */
  failedAnswer: InvitationAnswer | null;
  onAnswer: (invitation: StaffInvitationDTO, answer: InvitationAnswer) => void;
}

export function SalonInvitationCardOrganism({
  row,
  locale,
  now,
  isLead,
  isBusy,
  busyAnswer,
  failedAnswer,
  onAnswer,
}: SalonInvitationCardProps) {
  const t = useTranslations('salon.invitations');
  const tRoles = useTranslations('salon.roles');
  const tButtons = useTranslations('buttons');
  const headingId = useId();
  const { invitation } = row;
  const { title, subtitle } = resolveInvitationHeading(invitation);

  if (row.kind === 'resolved') {
    const message =
      row.status === 'ACCEPTED'
        ? title
          ? t('outcomeAccepted', { name: title })
          : t('outcomeAcceptedUnnamed')
        : title
          ? t('outcomeDeclined', { name: title })
          : t('outcomeDeclinedUnnamed');
    return (
      <li className={styles.noticeRow}>
        <p className={styles.notice} role='status'>
          {row.status === 'ACCEPTED' ? (
            <span className={styles.lineIcon} aria-hidden='true'>
              <CheckCircleIcon size={20} weight='fill' />
            </span>
          ) : (
            <span
              className={`${styles.lineIcon} ${styles.lineIconMuted}`}
              aria-hidden='true'>
              <XCircleIcon size={20} weight='regular' />
            </span>
          )}
          <span>{message}</span>
        </p>
      </li>
    );
  }

  if (row.kind === 'gone') {
    return (
      <li className={styles.noticeRow}>
        <p className={styles.notice} role='status'>
          <span
            className={`${styles.lineIcon} ${styles.lineIconMuted}`}
            aria-hidden='true'>
            <InfoIcon size={20} weight='regular' />
          </span>
          <span>{t('gone')}</span>
        </p>
      </li>
    );
  }

  const name = title ?? t('salonFallback');
  const sentLabel = formatInvitedAgo(invitation.invited_at, now, locale);

  return (
    <li>
      <article className={styles.card} aria-labelledby={headingId}>
        <div className={styles.cardHead}>
          <AvatarAtom
            src={invitation.owner_avatar_url ?? undefined}
            name={name}
            size='lg'
            decorative
          />
          <div className={styles.identity}>
            <h2 id={headingId} className={styles.cardTitle}>
              {name}
            </h2>
            {subtitle !== null && (
              <p className={styles.cardSubtitle}>{subtitle}</p>
            )}
            {/* When it was sent and as whom: one quiet line. */}
            <p className={styles.cardMeta}>
              {sentLabel !== ''
                ? t('cardMeta', {
                    ago: sentLabel,
                    role: tRoles(invitation.role),
                  })
                : t('cardRole', { role: tRoles(invitation.role) })}
            </p>
          </div>
        </div>

        <p className={styles.consent}>{t('cardConsent')}</p>

        {row.hasError && failedAnswer !== null && (
          <div className={styles.error} role='alert'>
            <span className={styles.lineIcon} aria-hidden='true'>
              <WarningCircleIcon size={18} weight='fill' />
            </span>
            <span className={styles.errorText}>{t('respondError')}</span>
            <ButtonAtom
              variant='text'
              size='sm'
              disabled={isBusy}
              onClick={() => onAnswer(invitation, failedAnswer)}>
              {tButtons('retry')}
            </ButtonAtom>
          </div>
        )}

        {/* Two answers of clearly different weight: joining is the action
            (filled on the card that leads the screen), declining is the quiet
            way out next to it. */}
        <div className={styles.actions}>
          <ButtonAtom
            variant={isLead ? 'primary' : 'outlined'}
            size='md'
            disabled={isBusy}
            aria-busy={busyAnswer === 'ACCEPT'}
            ariaLabel={t('acceptAria', { name })}
            onClick={() => onAnswer(invitation, 'ACCEPT')}
            className='haptic-press'>
            {t('accept')}
          </ButtonAtom>
          <ButtonAtom
            variant='text'
            size='md'
            disabled={isBusy}
            aria-busy={busyAnswer === 'DECLINE'}
            ariaLabel={t('declineAria', { name })}
            onClick={() => onAnswer(invitation, 'DECLINE')}
            className='haptic-press'>
            {t('decline')}
          </ButtonAtom>
        </div>
      </article>
    </li>
  );
}
