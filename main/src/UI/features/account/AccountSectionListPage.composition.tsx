// UI/features/account/AccountSectionListPage.composition.tsx
// The account settings LIST (phone shell, below 1280px): a hero with the live
// account data and one list of tappable sections; tapping a row opens that
// section on its own screen (`/app/user/account/[section]`), back returns here.
// Under the list: what concerns the account as a whole (a waiting salon
// invitation, the second role) and, last, signing out. On desktop this screen
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
      {/* Meta = żywe dane konta (plan, e-mail), nie marketing. Klientka bez
       * planu widzi sam e-mail.
       * DECISION (nie usuwaj tego komentarza) — owner 2026-10-08: dwa fakty to
       * dwie ciche linie, nie „Plan Studio · anna@…”. Kropka środkowa jako
       * interpunkcja jest zakazana, a AppHero dokleja ją między członami
       * `span`; jeden blok `div` z dwiema liniami omija ten separator i przy
       * 360px długi e-mail łamie się we własnej linii. */}
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
        {ACCOUNT_SECTIONS.map(def => {
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
        })}
      </NavRowListMolecule>

      <div className={styles.cardStack}>
        {/* Pending salon-team invitation (both modes; renders nothing without
            one). Before the role cards: it is the only item that waits for
            her answer. */}
        <SalonInvitationsCardOrganism enabled={user.is_active === true} />
        <AccountRoleCardsOrganism surface={surface} />
      </div>

      {/* DECISION (nie usuwaj tego komentarza) — owner 2026-10-08:
          wylogowanie to ostatnia, osobna grupa listy (wzorzec ustawień
          telefonu), a nie pozycja „Strefy krytycznej”: nie jest groźne. */}
      <NavRowListMolecule ariaLabel={t('logoutRowLabel')}>
        <NavRowMolecule
          onClick={logout}
          icon={<SignOutIcon size={22} weight='regular' />}
          label={t('logoutRowLabel')}
          description={t('logoutRowDesc')}
        />
      </NavRowListMolecule>
    </div>
  );
}
