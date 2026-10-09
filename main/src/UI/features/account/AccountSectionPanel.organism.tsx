// UI/features/account/AccountSectionPanel.organism.tsx
// Content of ONE account settings section. Only the open section is mounted,
// so only its own queries run (activity log, sessions, usage, invitations).
// Role gating is the same everywhere: account-surface.policy.

import type { AccountSectionId } from '../../../application/policies/account-sections.config';
import { AccountActivityPanelOrganism } from './AccountActivityPanel.organism';
import {
  AccountProfileLinkCardOrganism,
  AccountRecoveryEntryOrganism,
  AccountRoleCardsOrganism,
  DangerZonePanelOrganism,
} from './AccountPage.parts.organism';
import { AccountInfoSectionOrganism } from './components/AccountInfoSection.organism';
import { AccountPlanSectionOrganism } from './components/AccountPlanSection.organism';
import { DataExportSectionOrganism } from './components/DataExportSection.organism';
import { EmailPrefsSectionOrganism } from './components/EmailPrefsSection.organism';
import { NotificationPrefsSectionOrganism } from './components/NotificationPrefsSection.organism';
import { SalonInvitationsCardOrganism } from './components/SalonInvitationsCard.organism';
import { SessionsTabOrganism } from './components/SessionsTab.organism';
import { ThemeSectionOrganism } from './components/ThemeSection.organism';
import { UsageStatsSectionOrganism } from './components/UsageStatsSection.organism';
import type { AccountPageData } from './useAccountPageData';
import styles from './AccountPage.module.css';

type ReadyAccountData = Extract<AccountPageData, { status: 'ready' }>;

interface AccountSectionPanelProps {
  section: AccountSectionId;
  data: ReadyAccountData;
  /**
   * Role cards and the salon invitation are about the account as a whole. On
   * the phone they sit on the list screen, under the sections; on desktop
   * there is no list screen (the rail is the list), so they stay here.
   */
  withAccountWideCards: boolean;
}

export function AccountSectionPanelOrganism({
  section,
  data,
  withAccountWideCards,
}: AccountSectionPanelProps) {
  const { user, surface, pricingPlan } = data;

  switch (section) {
    case 'account':
      return (
        <div className={styles.cardStack}>
          {/* Pending salon-team invitation (both modes; renders nothing
              without one). First, because it is the only item here that
              waits for her answer. */}
          {withAccountWideCards && (
            <SalonInvitationsCardOrganism enabled={user.is_active === true} />
          )}
          <AccountInfoSectionOrganism
            name={user.name}
            email={user.email}
            imageUrl={user.image}
          />

          <AccountProfileLinkCardOrganism
            visible={surface.showStylistSections}
          />
          {surface.showBilling && pricingPlan !== null && (
            <AccountPlanSectionOrganism plan={pricingPlan} />
          )}

          {/* Kafle zużycia są STYLISTOWE (zdjęcia, przypięte, sparowane
              klientki, limity planu) — w trybie klientki pokazywały same zera
              obok etykiety „Free", czyli plan, którego klientka nie ma. */}
          {surface.showStylistSections && (
            <UsageStatsSectionOrganism
              showFavoriteStylists={surface.showFavoriteStylists}
            />
          )}

          {withAccountWideCards && (
            <AccountRoleCardsOrganism surface={surface} />
          )}
        </div>
      );
    case 'notifications':
      return (
        <div className={styles.cardStack}>
          <NotificationPrefsSectionOrganism
            notificationsEnabled={user.notifications_enabled}
          />
          {surface.showStylistSections && (
            <EmailPrefsSectionOrganism
              preferences={user.stylist_account?.email_preferences ?? null}
            />
          )}
        </div>
      );
    case 'appearance':
      return (
        <div className={styles.cardStack}>
          <ThemeSectionOrganism />
        </div>
      );
    case 'activity':
      return <AccountActivityPanelOrganism />;
    case 'security':
      return (
        <div className={styles.cardStack}>
          <SessionsTabOrganism />
        </div>
      );
    case 'data':
      return (
        <div className={styles.cardStack}>
          <DataExportSectionOrganism />
          <AccountRecoveryEntryOrganism />
        </div>
      );
    case 'danger':
      return <DangerZonePanelOrganism />;
    default: {
      const exhaustive: never = section;
      return exhaustive;
    }
  }
}
