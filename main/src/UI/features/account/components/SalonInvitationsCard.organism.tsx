// UI/features/account/components/SalonInvitationsCard.organism.tsx
// Entry to the salon-team invitations screen from the account screen, shown
// while an invitation waits for an answer. The e-mail is the primary way in;
// this card is the way back for whoever closed the e-mail. Shown in both role
// modes: the invitation is addressed to the person, not to a role.
//
// A failed read renders a compact error with a retry instead of nothing: an
// empty slot would claim "no invitations" (DECISION in salonInvitationsEntry).

import { useTranslations } from 'next-intl';
import {
  EnvelopeSimpleOpenIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { AppLinkAtom } from '../../../components/AppLink/AppLink.atom';
import { AffordanceDiscAtom } from '../../../components/AffordanceDisc/AffordanceDisc.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { useMySalonInvitationsEntry } from '../../shared/salon-staff/hooks/useMySalonInvitations';
import styles from './SalonInvitationsCard.module.css';

export function SalonInvitationsCardOrganism({
  enabled,
}: {
  /** Account positively active (same gate as the drawer item in AppLayout). */
  enabled: boolean;
}) {
  const t = useTranslations('account.page');
  const tButtons = useTranslations('buttons');
  const { entry, refetch, isRefetching } = useMySalonInvitationsEntry(enabled);

  if (entry.kind === 'hidden') {
    return null;
  }

  if (entry.kind === 'error') {
    return (
      <div className={styles.errorCard} role='status'>
        <span className={styles.icon} aria-hidden='true'>
          <EnvelopeSimpleOpenIcon size={20} weight='regular' />
        </span>
        <span className={styles.body}>
          <span className={styles.title}>
            {t('salonInvitationsErrorTitle')}
          </span>
          <span className={styles.errorText}>
            <WarningCircleIcon
              size={16}
              weight='fill'
              className={styles.errorIcon}
              aria-hidden='true'
            />
            {t('salonInvitationsLoadError')}
          </span>
          {/* Under the message, not beside it: at 390px a side button
              squeezed the title and the message into a one-word column. */}
          <span className={styles.errorAction}>
            <ButtonAtom
              variant='text'
              size='sm'
              disabled={isRefetching}
              aria-busy={isRefetching}
              onClick={refetch}>
              {tButtons('retry')}
            </ButtonAtom>
          </span>
        </span>
      </div>
    );
  }

  return (
    <AppLinkAtom href={ROUTES_FRONT.SALON_INVITATIONS} className={styles.card}>
      <span className={styles.icon} aria-hidden='true'>
        <EnvelopeSimpleOpenIcon size={20} weight='regular' />
      </span>
      <span className={styles.body}>
        <span className={styles.title}>
          {t('salonInvitationsTitle', { count: entry.count })}
        </span>
        <span className={styles.desc}>{t('salonInvitationsBody')}</span>
      </span>
      <AffordanceDiscAtom className={styles.disc} />
    </AppLinkAtom>
  );
}
