// UI/features/salon-staff/SalonInvitationsPage.composition.tsx
// Invitee screen (/app/salon/invitations, ROUTES_FRONT.SALON_INVITATIONS): the
// person invited to a salon team sees her pending invitations and accepts or
// declines each one. Linked from the invitation e-mail, the drawer and the
// account screen. Works in stylist AND client mode and on desktop (account
// route in route-access.policy), because the invitation is addressed to the
// person, not to a role.
//
// Feedback is the screen's own (the respond events are in eventsDisallowedForUI):
// an answered card turns into an inline confirmation in the same slot, a failed
// answer shows an inline error with a retry (buildInvitationRows).
//
// Stack: TQ v5 + CSS Modules + Phosphor.

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { EnvelopeSimpleOpenIcon } from '@phosphor-icons/react';
import type { StaffInvitationDTO } from '@kernel/models/salon-staff/salon-staff.dto';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { useMySalonInvitations } from '../shared/salon-staff/hooks/useMySalonInvitations';
import { useRespondInvitation } from './hooks/useRespondInvitation';
import {
  buildInvitationRows,
  type FailedAnswer,
  type InvitationAnswer,
  type InvitationStatus,
} from './salonInvitations.helpers';
import { SalonInvitationCardOrganism } from './SalonInvitationCard.organism';
import styles from './SalonInvitationsPage.module.css';

type ResolvedMap = Record<
  string,
  { invitation: StaffInvitationDTO; status: InvitationStatus }
>;

function SalonInvitationsPageInner() {
  const t = useTranslations('salon.invitations');
  const tButtons = useTranslations('buttons');
  const locale = useLocale();
  useAppBarTitle(t('title'));

  const query = useMySalonInvitations(true);
  const respond = useRespondInvitation();
  const [resolved, setResolved] = useState<ResolvedMap>({});
  const [failed, setFailed] = useState<FailedAnswer | null>(null);
  // Read once per render: relative dates only need day precision.
  const now = new Date();

  const handleAnswer = (
    invitation: StaffInvitationDTO,
    answer: InvitationAnswer
  ) => {
    if (respond.isPending) {
      return;
    }
    setFailed(null);
    respond.mutate(
      { staff_member_id: invitation.staff_member_id, response: answer },
      {
        onSuccess: data => {
          setResolved(prev => ({
            ...prev,
            [invitation.staff_member_id]: { invitation, status: data.status },
          }));
        },
        onError: () => {
          setFailed({ invitation, response: answer });
        },
      }
    );
  };

  const rows = buildInvitationRows({
    pending: query.data?.invitations ?? [],
    resolved,
    failed,
    isRefreshing: query.isFetching,
  });
  const pendingRows = rows.filter(row => row.kind === 'pending');
  // One filled action per screen: the oldest waiting invitation carries it,
  // any further one offers the same answer as an outlined button.
  const leadId = pendingRows[0]?.invitation.staff_member_id ?? null;
  const inFlight = respond.isPending ? respond.variables : undefined;

  const renderBody = () => {
    // Error only without data: a failed background refetch keeps the list.
    if (query.isError && query.data === undefined) {
      return (
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={tButtons('retry')}
          onRetry={() => void query.refetch()}
          isRetrying={query.isFetching}
        />
      );
    }
    if (query.data === undefined) {
      return (
        <ul className={styles.list} aria-busy='true'>
          {[0].map(i => (
            // The box of a real card: head, the consent lines, the answers.
            <li key={i} className={styles.card}>
              <div className={styles.cardHead}>
                <SkeletonAtom variant='circle' width={56} height={56} />
                <div className={styles.skeletonLines}>
                  <SkeletonAtom variant='text' width='55%' height={20} />
                  <SkeletonAtom variant='text' width='75%' height={16} />
                </div>
              </div>
              <div className={styles.skeletonLines}>
                <SkeletonAtom variant='text' width='100%' height={16} />
                <SkeletonAtom variant='text' width='80%' height={16} />
              </div>
              <SkeletonAtom variant='rect' className={styles.skeletonAction} />
            </li>
          ))}
        </ul>
      );
    }
    if (rows.length === 0) {
      return (
        <EmptyStateAtom
          size='page'
          icon={<EnvelopeSimpleOpenIcon size={40} weight='regular' />}
          title={t('emptyTitle')}
          titleAs='h2'
          description={t('emptyBody')}
          lang={locale}
        />
      );
    }
    return (
      <ul className={styles.list}>
        {rows.map(row => {
          const id = row.invitation.staff_member_id;
          return (
            <SalonInvitationCardOrganism
              key={id}
              row={row}
              locale={locale}
              now={now}
              isLead={id === leadId}
              isBusy={respond.isPending}
              busyAnswer={
                inFlight?.staff_member_id === id ? inFlight.response : null
              }
              failedAnswer={
                failed?.invitation.staff_member_id === id
                  ? failed.response
                  : null
              }
              onAnswer={handleAnswer}
            />
          );
        })}
      </ul>
    );
  };

  return (
    <div className={styles.page} lang={locale}>
      {/* Live number instead of a subtitle (S25/D); nothing waiting: the
          title alone. */}
      <AppHeroOrganism
        title={t('title')}
        {...(pendingRows.length > 0
          ? {
              meta: (
                <span>
                  {t('heroMetaPending', { count: pendingRows.length })}
                </span>
              ),
            }
          : {})}
      />
      {/* No aside: main keeps a readable measure on a wide page. */}
      <PageColumnsMolecule main={renderBody()} />
    </div>
  );
}

export function SalonInvitationsPageComposition() {
  return (
    <AppLayoutComposition>
      <SalonInvitationsPageInner />
    </AppLayoutComposition>
  );
}
