// UI/features/account/AccountSectionListPage.composition.tsx
// The account settings LIST (phone shell, below 1280px): a hero with the live
// account data and one list of tappable sections; tapping a row opens that
// section on its own screen (`/app/user/account/[section]`), back returns here.
// Under the list: what concerns the account as a whole (a waiting salon
// invitation, signing out and the second role). On desktop this screen
// does not exist: the rail of AccountWebLayout is the list (and holds its own
// sign-out).

import { useTranslations } from 'next-intl';
import { SignOutIcon } from '@phosphor-icons/react';
import { getPlanDisplayName } from '@kernel/domain/pricing/pricing.config';
import {
  ACCOUNT_SECTIONS,
  ACCOUNT_SECTIONS_I18N_NAMESPACE,
  buildAccountSectionHref,
} from '../../../application/policies/account-sections.config';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../components/NavRow/NavRow.molecule';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { AccountRoleCardsOrganism } from './AccountPage.parts.organism';
import {
  AccountLoadErrorMolecule,
  AccountPageSkeletonMolecule,
} from './AccountPageStates.molecule';
import { ACCOUNT_SECTION_ICONS } from './accountSections.icons';
import { SalonInvitationsCardOrganism } from './components/SalonInvitationsCard.organism';
import { useAccountPageData } from './useAccountPageData';
import styles from './AccountPage.module.css';

export function AccountSectionListViewComposition() {
  const t = useTranslations('account.page');
  const tSections = useTranslations(ACCOUNT_SECTIONS_I18N_NAMESPACE);
  useAppBarTitle(t('title'));
  const data = useAccountPageData();

  if (data.status === 'loading') {
    return <AccountPageSkeletonMolecule shape='list' />;
  }
  if (data.status === 'error') {
    return (
      <AccountLoadErrorMolecule
        onRetry={data.retry}
        isRetrying={data.isRetrying}
      />
    );
  }

  const { user, surface, pricingPlan, displayName, logout } = data;
  const showPlan = surface.showBilling && pricingPlan !== null;

  return (
    <div className={styles.page}>
      {/* Meta = live account data (plan, e-mail), not marketing. A client
       * without a plan sees the e-mail only.
       * DECISION: two facts are two quiet lines, not "Plan Studio · anna@…". The middle dot as
       * punctuation is banned, and AppHero appends a comma between `span` members; one `div` block
       * with two lines bypasses that separator and a long e-mail wraps within its own line at 360px.
       * (owner) */}
      <AppHeroOrganism
        title={displayName}
        meta={
          <div className={styles.heroMetaLines}>
            {showPlan && (
              <span>
                {t('heroMetaPlan', { plan: getPlanDisplayName(pricingPlan) })}
              </span>
            )}
            <span>{user.email}</span>
          </div>
        }
      />

      <NavRowListMolecule ariaLabel={tSections('sectionsAriaLabel')}>
        {ACCOUNT_SECTIONS.filter(def => def.id !== 'plan' || showPlan).map(
          def => {
            const Icon = ACCOUNT_SECTION_ICONS[def.id];
            // The plan is a stylist surface (account-surface.policy): a row
            // promising „plan” to a client would name something she does not have.
            const descriptionKey =
              def.id === 'account' && !showPlan
                ? 'sectionAccountDescBasic'
                : def.descriptionKey;
            return (
              <NavRowMolecule
                key={def.id}
                href={buildAccountSectionHref(def.id)}
                icon={<Icon size={22} weight='regular' />}
                label={tSections(def.labelKey)}
                description={tSections(descriptionKey)}
                trailing='chevron'
                tone={def.tone}
              />
            );
          }
        )}
      </NavRowListMolecule>

      <div className={styles.cardStack}>
        {/* Pending salon-team invitation (both modes; renders nothing without
            one). It takes priority because it waits for her answer. */}
        <SalonInvitationsCardOrganism enabled={user.is_active === true} />
      </div>

      {/* DECISION: logging out is a separate group of the list (the phone-settings
          pattern), not an item of the critical zone: it is not dangerous. (owner)
          The role cards follow it at the bottom of the account list. */}
      <NavRowListMolecule ariaLabel={t('logoutRowLabel')}>
        <NavRowMolecule
          onClick={logout}
          icon={<SignOutIcon size={22} weight='regular' />}
          label={t('logoutRowLabel')}
          description={t('logoutRowDesc')}
        />
      </NavRowListMolecule>
      <div className={styles.cardStack}>
        <AccountRoleCardsOrganism surface={surface} />
      </div>
    </div>
  );
}
