// UI/features/salon-staff/SalonStaffPage.composition.tsx
// Salon team page (/app/salon/staff): the owner sees who is in her team, who
// still has to accept, and invites the next person.
//
// Order of the screen (S126): intro with one line of live numbers → THE action
// (invite; at the plan's limit the plans link takes its place) → the team as
// cards (a grid from 720px of the page's own width) → the near-limit note.
// Plans without staff accounts get the locked notice; a team left over from
// Studio/Scale stays listed below it with removal only
// (salonStaffView.helpers.ts, DECISION).
//
// This file owns data, state and handlers; the sections are presentational.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/router';
import { UserPlusIcon } from '@phosphor-icons/react';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';
import { isUnlimitedLimit } from '@kernel/policies/pricing.policy';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { VALIDATION_REGEX } from '@kernel/policies/validation.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
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
  SalonStaffEmptyOrganism,
  SalonStaffHeroOrganism,
  SalonStaffListSkeletonOrganism,
  SalonStaffPlanNoteOrganism,
} from './SalonStaffPage.sections.organism';
import styles from './SalonStaffPage.module.css';

type PermissionKey = StaffPermission;

const PERMISSION_KEYS: readonly PermissionKey[] = STAFF_PERMISSIONS;

/* ─── Inner page (inside AppLayout context) ─── */

function SalonStaffPageInner() {
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
  const updatePermissions = useUpdateMemberPermissions();

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [detailStaffId, setDetailStaffId] = useState<string | null>(null);
  const currentPlan =
    user?.stylist_account?.pricing_plan ?? PricingPlanValue.FREE;
  const planConfig = PRICING_POLICY.utils.getPlanConfig(currentPlan);
  const isStudioOrAbove = PRICING_POLICY.utils.canUseStaffAccounts(planConfig);
  const maxStaffMembers = planConfig.max_staff_members;
  const isUnlimited = isUnlimitedLimit(maxStaffMembers);

  // #12: the plan is known only once `user` resolved (currentPlan defaults to
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

  const salonName = user?.stylist_account?.business_name ?? null;
  const currentUserId = user?.id ?? null;

  const removeName = memberToRemove
    ? getDisplayName(memberToRemove, t('inactiveAccount'))
    : null;

  // Dead-user seats still occupy usedSlots (members.length). A pending invite
  // also holds its seat (the row is active from the moment of the invitation).
  const pendingCount = members.filter(isPendingInvite).length;
  const usedSlots = members.length;
  const remainingSlots = isUnlimited
    ? Infinity
    : Math.max(0, maxStaffMembers - usedSlots);
  const isAtLimit = !isUnlimited && remainingSlots === 0;
  const isNearLimit = !isUnlimited && remainingSlots === 1;

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

  const goToPayPage = () => void router.push(ROUTES_FRONT.USER_ACCOUNT_PAY);
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

      {/* THE action of the screen. An empty team offers it inside the empty
          state, so it is not repeated here; at the limit inviting is not
          possible and the plans link takes the slot. */}
      {view.showStaffList && !isAtLimit && (
        <ButtonAtom
          variant='primary'
          size='md'
          icon={<UserPlusIcon size={16} weight='bold' />}
          onClick={openInvite}
          className={styles.pageAction}>
          {t('inviteBtn')}
        </ButtonAtom>
      )}
      {view.showStaffList && isAtLimit && (
        <SalonStaffPlanNoteOrganism isAtLimit remainingSlots={0} />
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

      {view.showStaffList && isNearLimit && (
        <SalonStaffPlanNoteOrganism
          isAtLimit={false}
          remainingSlots={remainingSlots}
        />
      )}

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
