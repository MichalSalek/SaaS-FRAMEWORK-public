import { SalonGalleryOrganism } from '../salon-profile/SalonGallery.organism';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { SALON_STAFF_DTO_API_V1 } from '@kernel/models/salon-staff/salon-staff.dto';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  getMySalonTeam_IO,
  leaveSalonTeam_IO,
} from '../../../domain/salon-staff/salonStaffIO.possibilities.api';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import { pushNewSnackbar } from '../../../application/app-snackbar/appSnackbar.possibilities.api';
import { buildRoute } from '../../../application/routing/buildRoute';
import { trackFlowStep } from '../../../application/analytics/flow-events';
import { flowErrorCode } from '../shared/analytics/flowErrorCode';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../components/NavRow/NavRow.molecule';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { AppDialogAtom } from '../../primitives/AppDialog.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import styles from './SalonStaffPage.module.css';

type Team =
  SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_MY_TEAM']['RESPONSE']['teams'][number];

export function SalonMemberTeamsOrganism({
  teams,
  currentUserId,
}: {
  teams: Team[];
  currentUserId: string;
}) {
  const t = useTranslations('salon.member');
  const queryClient = useQueryClient();
  const [openGallery, setOpenGallery] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<Team | null>(null);
  const refreshController = useRef<AbortController | null>(null);
  useEffect(() => () => refreshController.current?.abort(), [currentUserId]);
  const refreshTeams = useCallback(() => {
    // A gallery 404 can also mean lost membership; only a fresh team response can tell the UI
    // whether the salon is still listed and its gallery is unavailable.
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    void getMySalonTeam_IO(undefined, {
      signal: controller.signal,
      silentBusinessError: true,
    })
      .then(data => {
        if (!controller.signal.aborted) {
          queryClient.setQueryData(queryKeys.staff.myTeam, data);
        }
      })
      .catch(() => undefined);
  }, [queryClient]);
  const leave = useMutation({
    // One success owner: the sentence below; the backend event
    // (SALON_STAFF_REMOVED) is worded for the owner who removes someone.
    mutationFn: (
      input: SALON_STAFF_DTO_API_V1['SALON_STAFF_LEAVE_TEAM']['REQUEST']
    ) =>
      leaveSalonTeam_IO(input, {
        silentBusinessError: true,
        successFeedback: 'screen',
      }),
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      trackFlowStep('salon_team', 'member_left');
      pushNewSnackbar(t('leaveSuccess'), 'success');
      setLeaving(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.staff.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.current,
      });
    },
    onError: error => {
      trackFlowStep('salon_team', 'failed', {
        action: 'leave',
        code: flowErrorCode(error),
      });
      pushNewSnackbar(t('leaveError'), 'error');
    },
  });
  const profileProps = (identifier: string | null) =>
    identifier
      ? { href: buildRoute(ROUTES_FRONT.STYLIST_PROFILE, { identifier }) }
      : {};
  return (
    <>
      {teams.map(team => (
        <section key={team.salon_account_id} className={styles.memberTeam}>
          <TypographyAtom variant='h3' as='h2' data-app-section-title=''>
            {t('salonName', { name: team.salon_name })}
          </TypographyAtom>
          <NavRowListMolecule ariaLabel={t('title')}>
            <NavRowMolecule
              label={
                team.owner.name?.trim() ||
                t(team.owner.user_id === currentUserId ? 'ownerSelf' : 'owner')
              }
              {...(team.owner.name?.trim()
                ? {
                    description: t(
                      team.owner.user_id === currentUserId
                        ? 'ownerSelf'
                        : 'owner'
                    ),
                  }
                : {})}
              leading={
                <AvatarAtom
                  name={team.owner.name?.trim() ?? ''}
                  src={team.owner.image ?? undefined}
                  decorative
                />
              }
              {...profileProps(team.owner.public_profile_id)}
              trailing='disc'
            />
            {team.members.map(member => (
              <NavRowMolecule
                key={member.staff_member_id}
                label={
                  member.name?.trim() ||
                  t(
                    member.user_id === currentUserId ? 'stylistSelf' : 'stylist'
                  )
                }
                {...(member.name?.trim()
                  ? {
                      description: t(
                        member.user_id === currentUserId
                          ? 'stylistSelf'
                          : 'stylist'
                      ),
                    }
                  : {})}
                leading={
                  <AvatarAtom
                    name={member.name?.trim() ?? ''}
                    src={member.image ?? undefined}
                    decorative
                  />
                }
                {...profileProps(member.public_profile_id)}
                trailing='disc'
              />
            ))}
          </NavRowListMolecule>
          {team.gallery_available === false ? (
            <TypographyAtom>{t('galleryUnavailable')}</TypographyAtom>
          ) : (
            <ButtonAtom
              variant='outlined'
              onClick={() =>
                setOpenGallery(current =>
                  current === team.salon_account_id
                    ? null
                    : team.salon_account_id
                )
              }
              aria-controls={`salon-gallery-${team.salon_account_id}`}
              aria-expanded={openGallery === team.salon_account_id}>
              {t(
                openGallery === team.salon_account_id
                  ? 'hideGallery'
                  : 'showGallery'
              )}
            </ButtonAtom>
          )}
          {team.gallery_available !== false &&
            openGallery === team.salon_account_id && (
              <div
                id={`salon-gallery-${team.salon_account_id}`}
                className={styles.memberGallery}>
                <SalonGalleryOrganism
                  salonAccountId={team.salon_account_id}
                  audience='team'
                  onUnavailable={refreshTeams}
                />
              </div>
            )}
          <div className={styles.memberExit}>
            <ButtonAtom variant='text' onClick={() => setLeaving(team)}>
              {t('leave')}
            </ButtonAtom>
          </div>
        </section>
      ))}
      <AppDialogAtom
        open={leaving !== null}
        onOpenChange={open => {
          if (!open && !leave.isPending) {
            setLeaving(null);
          }
        }}
        disablePointerDismissal>
        <AppDialogAtom.Content
          title={t('leaveTitle')}
          description={t('leaveBody', { salon: leaving?.salon_name ?? '' })}
          closeDisabled={leave.isPending}>
          <AppDialogAtom.Actions>
            <ButtonAtom
              variant='outlined'
              disabled={leave.isPending}
              onClick={() => setLeaving(null)}>
              {t('stay')}
            </ButtonAtom>
            <ButtonAtom
              variant='danger'
              disabled={leave.isPending}
              aria-busy={leave.isPending}
              onClick={() => {
                if (leaving) {
                  leave.mutate({ salon_account_id: leaving.salon_account_id });
                }
              }}>
              {t('leave')}
            </ButtonAtom>
          </AppDialogAtom.Actions>
        </AppDialogAtom.Content>
      </AppDialogAtom>
    </>
  );
}
