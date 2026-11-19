import type { useTranslations } from 'next-intl';
import type { SupportThreadStatus } from '@kernel/models/support/support.dto';
import { StatusPillAtom } from '../../../components/StatusPill/StatusPill.atom';

/**
 * Support thread status in the ADMIN view: one pill for the list and for the thread details. The
 * visual recipe (tint 12% / outline 30% / text 85%) is carried by `StatusPillAtom`; only the domain
 * map stays here.
 *
 * DECISION: the colours are deliberately NOT aligned with the client-side `getSupportStatusColor`.
 * The client sees her own thread: OPEN means "the case is alive" and gets green. The admin sees a
 * work queue: OPEN means "awaiting reply" and must differ from RESOLVED, which is the success only
 * here. One status name carries two meanings because two roles look at the screen; merging the maps
 * would take the urgency signal away from the admin.
 */
export function SupportStatusBadgeMolecule({
  status,
  awaitingReply = false,
  t,
}: {
  status: SupportThreadStatus;
  /**
   * The thread is open and its latest message is the person's: the ONE pill
   * says „Czeka na odpowiedź” instead of „Otwarty” (the queue used to carry
   * two pills per row for that, a status and a „Czeka” tag next to the name).
   */
  awaitingReply?: boolean;
  t: ReturnType<typeof useTranslations<'admin.support'>>;
}) {
  return (
    <StatusPillAtom
      color={getAdminSupportStatusColor(status)}
      label={
        awaitingReply
          ? t('awaitingReply')
          : getAdminSupportStatusLabel(status, t)
      }
    />
  );
}

function getAdminSupportStatusColor(status: SupportThreadStatus): string {
  switch (status) {
    case 'OPEN':
      return 'var(--color-warning)';
    case 'RESOLVED':
      return 'var(--color-success)';
    default:
      return 'var(--color-text-secondary)';
  }
}

function getAdminSupportStatusLabel(
  status: SupportThreadStatus,
  t: ReturnType<typeof useTranslations<'admin.support'>>
): string {
  switch (status) {
    case 'OPEN':
      return t('statusOpen');
    case 'RESOLVED':
      return t('statusResolved');
    default:
      return t('statusClosed');
  }
}
