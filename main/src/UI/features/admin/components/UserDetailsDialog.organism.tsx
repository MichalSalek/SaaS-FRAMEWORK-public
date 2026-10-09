// admin/components/UserDetailsDialog.tsx
// User details in a full-height side sheet (AppSheet, from the left, swipe to
// close) with tabs (the shared segmented control): Profile, Emails, Activity,
// Actions. S122: moved off
// the centered AppDialog card — the owner wanted more room for the data and the
// same sheet for log details.
// Email History + Timeline tabs fetch lazily via `enabled` flag.
// ProfileTab + ActionsTab live in UserDetailsDialog.tabs.tsx to keep both
// files under the 300 LOC ceiling.

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { EnvelopeSimpleIcon, UserSwitchIcon } from '@phosphor-icons/react';
import { AppSheetAtom } from '../../../primitives/AppSheet.atom';
import type { AdminUserRecord } from '../hooks/useAdminUsers';
import { EmailHistoryTabOrganism } from './EmailHistoryTab.organism';
import { UserTimelineTabOrganism } from './UserTimelineTab.organism';
import {
  ProfileTabMolecule,
  ActionsTabOrganism,
} from './UserDetailsDialog.tabs.organism';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { useBecomeUser } from '../hooks/useBecomeUser';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { LinkButtonAtom } from '../../../components/Button/LinkButton.atom';
import { SegmentedControlMolecule } from '../../../components/SegmentedControl/SegmentedControl.molecule';
import styles from './UserDetailsDialog.module.css';

/* ─── Tabs ─── */

type TabKey = 'profile' | 'email-history' | 'timeline' | 'actions';

const USER_TAB_ID_PREFIX = 'admin-user-tab-';
const USER_TAB_PANEL_ID = 'admin-user-tabpanel';

/* ─── Dialog ─── */

export interface UserDetailsDialogProps {
  user: AdminUserRecord | null;
  open: boolean;
  onClose: () => void;
}

export function UserDetailsDialogOrganism({
  user,
  open,
  onClose,
}: UserDetailsDialogProps) {
  const t = useTranslations('admin.users');
  const [activeTab, setActiveTab] = useState<TabKey>('profile');
  const becomeUserMut = useBecomeUser();
  const { data: currentUser } = useCurrentUserAccount();

  // Reset tab to profile when dialog opens for a new user
  useEffect(() => {
    if (open && user) {
      setActiveTab('profile');
    }
  }, [open, user]);

  // DECISION (nie usuwaj tego komentarza):
  // Impersonation gate (defense-in-depth — backend re-validates everything):
  //   1. Admin cannot impersonate themselves (no-op + confusing UX).
  //   2. Admin cannot impersonate another admin — keeps the
  //      original-admin → target-user one-way flow that switch-back assumes
  //      (backup table has unique constraint on admin_user_id). Nested
  //      admin-on-admin would orphan the original backup row.
  //   3. Target user is not disabled — yes, admin CAN impersonate disabled
  //      users (see backend DECISION comment in BECOME_USER handler); UI
  //      surfaces the action regardless so admin retains the override.
  const canImpersonate =
    user !== null &&
    currentUser !== undefined &&
    user.id !== currentUser.id &&
    user.role_id !== SystemRoleId.MASTER_ADMIN;

  // DECISION (nie usuwaj tego komentarza):
  // Moderation actions tab is hidden when the target is the acting admin
  // themselves OR another admin. Backend re-validates (admin cannot
  // delete/disable an admin, cannot delete self), but hiding the controls
  // prevents accidental clicks and confusing failure toasts.
  const isSelfOrTargetAdmin = (() => {
    if (user === null || currentUser === undefined) {
      return true;
    }
    return (
      user.id === currentUser.id || user.role_id === SystemRoleId.MASTER_ADMIN
    );
  })();

  const showActionsTab = !isSelfOrTargetAdmin;

  const handleImpersonate = () => {
    if (!user) {
      return;
    }
    becomeUserMut.mutate(
      { id: user.id },
      {
        // useBecomeUser sets `suppressGlobalError: true` (this dialog owns the
        // user-facing toast). Without a per-call onError a failed impersonation
        // would re-enable the button silently — surface the failure here.
        onError: () => {
          pushNewSnackbar(t('impersonateError'), 'error');
        },
      }
    );
    // On success becomeUser_IO reloads the whole document into the
    // impersonated identity — no onClose() needed, the page goes away.
  };

  // After destructive action (delete), the user record is gone from the list.
  // Close dialog so admin returns to the (now invalidated) users table.
  const handleActionComplete = () => {
    onClose();
  };

  const tabs: { value: TabKey; label: string }[] = [
    { value: 'profile', label: t('tabProfile') },
    { value: 'email-history', label: t('tabEmailHistory') },
    { value: 'timeline', label: t('tabTimeline') },
    ...(showActionsTab
      ? [{ value: 'actions' as const, label: t('tabActions') }]
      : []),
  ];

  // Tytuł arkusza = kto to jest (nazwa, a bez niej e-mail); e-mail schodzi do
  // opisu tylko wtedy, gdy tytułem jest nazwa — bez dublowania tej samej linii.
  const displayName = user?.name?.trim() ?? '';
  const sheetTitle =
    displayName || user?.email?.trim() || t('detailsDialogTitle');
  const sheetDescription = displayName ? user?.email : undefined;

  return (
    <AppSheetAtom
      open={open}
      onOpenChange={next => {
        if (!next) {
          onClose();
        }
      }}
      title={sheetTitle}
      {...(sheetDescription ? { description: sheetDescription } : {})}
      closeLabel={t('close')}
      size='wide'
      footer={
        user?.email || canImpersonate ? (
          <>
            {user?.email ? (
              <LinkButtonAtom
                variant='outlined'
                size='sm'
                href={`mailto:${user.email}`}
                icon={<EnvelopeSimpleIcon size={14} weight='regular' />}
                ariaLabel={t('writeEmailAriaLabel', { email: user.email })}>
                {t('writeEmail')}
              </LinkButtonAtom>
            ) : null}
            {canImpersonate ? (
              <ButtonAtom
                variant='outlined'
                size='sm'
                className='haptic-press'
                icon={<UserSwitchIcon size={14} weight='regular' />}
                onClick={handleImpersonate}
                loading={becomeUserMut.isPending}
                ariaLabel={t('impersonateAriaLabel', {
                  // name is DB-default '' for nameless users → `?? email` never
                  // falls through (S67a class); `.trim() ||` reaches email/''.
                  name: user?.name?.trim() || user?.email?.trim() || '',
                })}>
                {t('impersonate')}
              </ButtonAtom>
            ) : null}
          </>
        ) : undefined
      }>
      {/* The shared segmented control in its tabs semantics: one Tab stop,
          arrows move and select, each tab points at the single panel below.
          Four short labels, no icons: the track must hold on a 360px phone
          with German copy. */}
      <SegmentedControlMolecule
        semantics='tabs'
        fullWidth
        ariaLabel={t('tabsAriaLabel')}
        value={activeTab}
        onChange={setActiveTab}
        options={tabs.map(tab => ({
          ...tab,
          id: `${USER_TAB_ID_PREFIX}${tab.value}`,
          controls: USER_TAB_PANEL_ID,
        }))}
      />
      <div
        id={USER_TAB_PANEL_ID}
        className={styles.tabPanel}
        role='tabpanel'
        aria-labelledby={`${USER_TAB_ID_PREFIX}${activeTab}`}>
        {user && activeTab === 'profile' && <ProfileTabMolecule user={user} />}
        {user && activeTab === 'email-history' && (
          <EmailHistoryTabOrganism userId={user.id} />
        )}
        {user && activeTab === 'timeline' && (
          <UserTimelineTabOrganism userId={user.id} />
        )}
        {user && activeTab === 'actions' && showActionsTab && (
          <ActionsTabOrganism
            user={user}
            onActionComplete={handleActionComplete}
          />
        )}
      </div>
    </AppSheetAtom>
  );
}
