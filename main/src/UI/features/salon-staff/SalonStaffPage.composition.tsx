import { SalonSetupEntryOrganism } from '../salon-profile/SalonSetupEntry.organism';
import { OutcomeStateMolecule } from '../../components/OutcomeFeedback/OutcomeState.molecule';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
// UI/features/salon-staff/SalonStaffPage.composition.tsx
// Salon team page (/app/salon/staff): the owner sees who is in her team, who
// still has to accept, and invites the next person.
//
// Order of the screen: intro with one line of live numbers → THE action
// (invite stays reachable at the cap) → the quota note beside it → the team as
// cards (a grid from 720px of the page's own width).
// Plans without staff accounts get the locked notice; a team left over from
// Studio/Scale stays listed below it with removal only
// (salonStaffView.helpers.ts, DECISION).
//
// This file owns data, state and handlers; the sections are presentational.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMySalonTeam_IO } from '../../../domain/salon-staff/salonStaffIO.possibilities.api';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import { SalonMemberTeamsOrganism } from './SalonMemberTeams.organism';
import { SalonProfileVisibilityOrganism } from '../salon-profile/SalonProfileVisibility.organism';
import { NavRowListSkeletonMolecule } from '../../components/NavRow/NavRow.molecule';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/router';
import { UserPlusIcon } from '@phosphor-icons/react';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';
import { isUnlimitedLimit } from '@kernel/policies/pricing.policy';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { VALIDATION_REGEX } from '@kernel/policies/validation.config';
import { buildPlanPayDeepLink } from '../shared/pricing/pricingFunnelHref';
import {
  STAFF_PERMISSIONS,
  type StaffPermission,
} from '@kernel/domain/user-and-account/staff_accounts.config';
import type { StaffMemberDTO } from '@kernel/models/salon-staff/salon-staff.dto';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { useSalonMembers } from './hooks/useSalonMembers';
import { useInviteMember } from './hooks/useInviteMember';
import { useRemoveMember } from './hooks/useRemoveMember';
import { useUpdateMemberPermissions } from './hooks/useUpdateMemberPermissions';
import {
  getAvatarSrc,
  getDisplayName,
  isPendingInvite,
} from './salonStaffDisplay.helpers';
import {
  resolveRemoveVariant,
  resolveSalonStaffView,
} from './salonStaffView.helpers';
import { StaffMemberCardOrganism } from './StaffMemberCard.organism';
import { SalonStaffRemoveOnlyListOrganism } from './SalonStaffRemoveOnlyList.organism';
import { SalonStaffDialogsComposition } from './SalonStaffDialogs.composition';
import { SalonStaffDetailDialogComposition } from './SalonStaffDetailDialog.composition';
import {
  getLowestEligibleUpgradePlan,
  getQuotaFailureFeature,
  resolveQuotaSnapshot,
} from '../../../application/pricing/quota.helpers';
import { isIOError } from '../../../application/http/io';
import { flowErrorCode } from '../shared/analytics/flowErrorCode';
import { QuotaUpgradeDialogOrganism } from '../shared/upsell/QuotaUpgradeDialog.organism';
import { usePurchaseResumeCapture } from '../shared/upsell/usePurchaseResumeCapture';
import {
  SalonStaffEmptyOrganism,
  SalonStaffHeroOrganism,
  SalonStaffListSkeletonOrganism,
  SalonStaffPlanNoteOrganism,
} from './SalonStaffPage.sections.organism';
import styles from './SalonStaffPage.module.css';

type PermissionKey = StaffPermission;

const PERMISSION_KEYS: readonly PermissionKey[] = STAFF_PERMISSIONS;

/* ─── Inner page (inside AppLayout context) ─── */

function SalonOwnerStaffPageInner() {
  const captureResume = usePurchaseResumeCapture();
  const t = useTranslations('salon.staff');
  const tPermissions = useTranslations('salon.permissions');
  const tRoles = useTranslations('salon.roles');
  const tButtons = useTranslations('buttons');
  const router = useRouter();

  useAppBarTitle(t('title'));

  const { data: user } = useCurrentUserAccount();
  const {
    members,
    isLoading,
    isFetching,
    isError,
    hasData: rosterFetched,
    refetch,
  } = useSalonMembers();
  const inviteMember = useInviteMember();
  const feedback = useTranslations('components.outcomeFeedback');
  const updatePermissions = useUpdateMemberPermissions();

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [quotaUpgradeOpen, setQuotaUpgradeOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [detailStaffId, setDetailStaffId] = useState<string | null>(null);
  const currentPlan =
    user?.stylist_account?.pricing_plan ?? PricingPlanValue.FREE;
  const planConfig = PRICING_POLICY.utils.getPlanConfig(currentPlan);
  const isStudioOrAbove = PRICING_POLICY.utils.canUseStaffAccounts(planConfig);
  const maxStaffMembers = planConfig.max_staff_members;
  const isUnlimited = isUnlimitedLimit(maxStaffMembers);

  // The plan is known only once `user` resolved (currentPlan defaults to
  // FREE, which would flash the locked notice before the real plan arrives).
  // Everything derived from `members` waits for a KNOWN roster: while loading
  // or after a failed fetch `members` is [] and used to render as "0 active".
  const isPlanKnown = user !== undefined;
  const view = resolveSalonStaffView({
    isPlanKnown,
    canUseStaffAccounts: isStudioOrAbove,
    isRosterLoading: isLoading,
    isRosterError: isError,
    isRosterFetched: rosterFetched,
    memberCount: members.length,
  });

  const memberToRemove = members.find(m => m.id === confirmRemoveId) ?? null;
  const removeVariant = resolveRemoveVariant(
    memberToRemove,
    view.showRemoveOnlyList
  );
  const removeMember = useRemoveMember({
    successMessageKey:
      removeVariant === 'freeSlot' ? 'freeSlotSuccess' : 'removeSuccess',
  });

  // Same name her clients and team read (kernel `salonDisplayName`, resolved
  // server-side), never the bare business name.
  const salonName = user?.stylist_account?.salon_display_name || null;
  const currentUserId = user?.id ?? null;

  const removeName = memberToRemove
    ? getDisplayName(memberToRemove, t('inactiveAccount'))
    : null;

  // Dead-user seats still occupy usedSlots (members.length). A pending invite
  // also holds its seat (the row is active from the moment of the invitation).
  const pendingCount = members.filter(isPendingInvite).length;
  const usedSlots = members.length;
  const staffQuota =
    isPlanKnown && rosterFetched && isStudioOrAbove
      ? resolveQuotaSnapshot(usedSlots, maxStaffMembers)
      : { state: 'unknown' as const };

  const permissionLabels: Record<PermissionKey, string> = {
    GALLERY_VIEW: tPermissions('GALLERY_VIEW'),
    GALLERY_EDIT: tPermissions('GALLERY_EDIT'),
    PAIRING_MANAGE: tPermissions('PAIRING_MANAGE'),
    SESSION_SHARE_RECEIVE: tPermissions('SESSION_SHARE_RECEIVE'),
  };

  const roleLabels: Record<StaffMemberDTO['role'], string> = {
    OWNER: tRoles('OWNER'),
    MANAGER: tRoles('MANAGER'),
    EMPLOYEE: tRoles('EMPLOYEE'),
  };

  const handleTogglePermission = (
    member: StaffMemberDTO,
    perm: PermissionKey
  ) => {
    const hasPermission = member.permissions.includes(perm);
    const nextPermissions: PermissionKey[] = hasPermission
      ? member.permissions.filter(p => p !== perm)
      : [...member.permissions, perm];

    updatePermissions.mutate({
      staffId: member.id,
      data: { permissions: nextPermissions },
    });
  };

  const handleInvite = () => {
    const email = inviteEmail.trim();
    if (!email || !VALIDATION_REGEX.EMAIL.test(email)) {
      return;
    }
    inviteMember.mutate(
      { email, role: 'EMPLOYEE' },
      {
        onSuccess: () => {
          setInviteEmail('');
          setIsInviteOpen(false);
        },
        onError: error => {
          if (
            getQuotaFailureFeature(
              'staff',
              flowErrorCode(error),
              isIOError(error) ? error.httpError.data : undefined
            ) === 'staff'
          ) {
            inviteMember.reset();
            setIsInviteOpen(false);
            setQuotaUpgradeOpen(true);
          }
        },
      }
    );
  };

  const handleRemoveConfirm = () => {
    if (!confirmRemoveId || removeMember.isPending) {
      return;
    }
    removeMember.mutate(confirmRemoveId, {
      onSuccess: () => {
        setConfirmRemoveId(null);
      },
    });
  };

  const staffUpgradePlan = getLowestEligibleUpgradePlan('staff', currentPlan);
  const goToPayPage = () => {
    if (staffUpgradePlan !== null) {
      captureResume({ kind: 'team' });
      void router.push(buildPlanPayDeepLink(staffUpgradePlan, 'month'));
    }
  };
  const openInvite = () => setIsInviteOpen(true);

  const heroTitle = salonName
    ? t('heroTitleWithName', { salon: salonName })
    : t('heroTitleSolo');

  const requestRemove = (id: string) => {
    if (removeMember.isPending) {
      return;
    }
    setConfirmRemoveId(id);
  };

  // The first roster load of a plan that manages a team: the numbers line, the
  // action and the cards all keep their place with skeletons.
  const isTeamLoading = isLoading && (!isPlanKnown || isStudioOrAbove);

  return (
    <div className={styles.page}>
      <SalonStaffHeroOrganism
        heroTitle={heroTitle}
        isSeatsLoading={isTeamLoading}
        seats={
          view.showSeatUsage
            ? {
                used: usedSlots,
                max: maxStaffMembers,
                isUnlimited,
                pending: pendingCount,
              }
            : null
        }
      />

      <SalonSetupEntryOrganism />
      {/* THE action of the screen. An empty team offers it inside the empty
          state, so it is not repeated here. A capped invite is still submitted
          to the server; its OperationResult opens the contextual upgrade dialog. */}
      {view.showStaffList && (
        <ButtonAtom
          variant='primary'
          size='md'
          icon={<UserPlusIcon size={16} weight='bold' />}
          onClick={openInvite}
          className={styles.pageAction}>
          {t('inviteBtn')}
        </ButtonAtom>
      )}
      {view.showStaffList &&
        (staffQuota.state === 'one_remaining' ||
          staffQuota.state === 'exhausted') && (
          <SalonStaffPlanNoteOrganism quota={staffQuota} />
        )}

      {/* The notice depends on the plan alone: it stays above a failed roster
          load and above the leftover team it explains. */}
      {view.showLockedNotice && (
        <SalonStaffEmptyOrganism variant='locked' onCtaClick={goToPayPage} />
      )}

      {view.showRosterError && (
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={tButtons('retry')}
          onRetry={() => void refetch()}
          isRetrying={isFetching}
        />
      )}

      {isLoading && (
        <SalonStaffListSkeletonOrganism withAction={isTeamLoading} />
      )}

      {view.showRemoveOnlyList && (
        <SalonStaffRemoveOnlyListOrganism
          members={members}
          onRemove={requestRemove}
          isRemovePending={removeMember.isPending}
        />
      )}

      {view.showEmptyState && (
        <SalonStaffEmptyOrganism variant='empty' onCtaClick={openInvite} />
      )}

      {view.showStaffList && (
        <ul className={styles.staffGrid} aria-label={t('title')}>
          {members.map(member => (
            <StaffMemberCardOrganism
              key={member.id}
              member={member}
              displayName={getDisplayName(member, t('inactiveAccount'))}
              avatarSrc={getAvatarSrc(member)}
              roleLabel={roleLabels[member.role]}
              permissionKeys={PERMISSION_KEYS}
              permissionLabels={permissionLabels}
              isCurrentUser={
                currentUserId !== null && member.user?.id === currentUserId
              }
              onRemove={requestRemove}
              onTogglePermission={handleTogglePermission}
              {...(member.user_inactive
                ? {}
                : { onViewDetail: (id: string) => setDetailStaffId(id) })}
              isRemovePending={removeMember.isPending}
            />
          ))}
        </ul>
      )}

      <OutcomeStateMolecule
        confirmed={inviteMember.isSuccess}
        completionKey={inviteMember.submittedAt}
        message={
          inviteMember.variables
            ? feedback('invitationSent', {
                email: inviteMember.variables.email,
              })
            : undefined
        }
      />
      <OutcomeStateMolecule
        confirmed={removeMember.isSuccess}
        marked={false}
        message={t('removeSuccess')}
      />
      <OutcomeStateMolecule
        confirmed={updatePermissions.isSuccess && !updatePermissions.isPending}
        marked={false}
        message={t('permissionsSuccess')}
      />
      <SalonStaffDialogsComposition
        isInviteOpen={isInviteOpen}
        inviteEmail={inviteEmail}
        isInvitePending={inviteMember.isPending}
        inviteError={inviteMember.isError}
        onInviteOpenChange={setIsInviteOpen}
        onInviteEmailChange={setInviteEmail}
        onInviteSubmit={handleInvite}
        removeName={removeName}
        removeVariant={removeVariant}
        isRemovePending={removeMember.isPending}
        onRemoveCancel={() => setConfirmRemoveId(null)}
        onRemoveConfirm={handleRemoveConfirm}
      />

      <SalonStaffDetailDialogComposition
        staffId={detailStaffId}
        onClose={() => setDetailStaffId(null)}
      />
      <QuotaUpgradeDialogOrganism
        open={quotaUpgradeOpen}
        feature='staff'
        currentPlan={currentPlan}
        onClose={() => setQuotaUpgradeOpen(false)}
      />
    </div>
  );
}

function SalonStaffPageInner() {
  const t = useTranslations('salon.staff');
  const tButtons = useTranslations('buttons');
  useAppBarTitle(t('title'));
  const { data: user } = useCurrentUserAccount();
  const team = useQuery({
    queryKey: queryKeys.staff.myTeam,
    queryFn: ({ signal }) => getMySalonTeam_IO(undefined, { signal }),
    enabled: user !== undefined,
    staleTime: 30_000,
  });
  const isOwner =
    user?.stylist_account !== undefined &&
    user.stylist_account !== null &&
    PRICING_POLICY.utils.canUseStaffAccounts(
      PRICING_POLICY.utils.getPlanConfig(user.stylist_account.pricing_plan)
    );
  if (!user || team.isLoading) {
    return <NavRowListSkeletonMolecule leading />;
  }
  if (team.isError) {
    return (
      <ErrorStateMolecule
        message={t('loadError')}
        retryLabel={tButtons('retry')}
        onRetry={() => void team.refetch()}
        isRetrying={team.isFetching}
      />
    );
  }
  const teams = team.data?.teams ?? [];
  return (
    <div className={styles.memberPage}>
      {teams.length > 0 && (
        <>
          <AppHeroOrganism title={t('title')} />
          <SalonProfileVisibilityOrganism />
          <SalonMemberTeamsOrganism teams={teams} currentUserId={user.id} />
        </>
      )}
      {(isOwner || teams.length === 0) && <SalonOwnerStaffPageInner />}
    </div>
  );
}

/* ─── Page export ─── */

export function SalonStaffPageComposition() {
  return (
    <AppLayoutComposition>
      <SalonStaffPageInner />
    </AppLayoutComposition>
  );
}
