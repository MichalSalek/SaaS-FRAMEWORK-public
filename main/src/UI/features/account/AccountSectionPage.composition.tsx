// UI/features/account/AccountSectionPage.composition.tsx
// One account settings section on its own screen
// (`/app/user/account/[section]`; on desktop also the bare account route,
// which shows the default section inline).
//
// Phone: the app bar carries the section label, so there is no intro card and
// the content starts right away. Desktop (AccountWebLayout has no app bar):
// the page heading is the section label and the rail marks the open section.

import { useTranslations } from 'next-intl';
import {
  ACCOUNT_SECTIONS_I18N_NAMESPACE,
  getAccountSectionDef,
  type AccountSectionId,
} from '../../../application/policies/account-sections.config';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import {
  AccountLoadErrorMolecule,
  AccountPageSkeletonMolecule,
} from './AccountPageStates.molecule';
import { AccountSectionPanelOrganism } from './AccountSectionPanel.organism';
import { useAccountPageData } from './useAccountPageData';
import { useAccountShell } from './useAccountShell';
import styles from './AccountPage.module.css';

export function AccountSectionViewComposition({
  section,
}: {
  section: AccountSectionId;
}) {
  const tSections = useTranslations(ACCOUNT_SECTIONS_I18N_NAMESPACE);
  const label = tSections(getAccountSectionDef(section).labelKey);
  useAppBarTitle(label);

  const shell = useAccountShell();
  const data = useAccountPageData();

  if (shell === 'pending' || data.status === 'loading') {
    return <AccountPageSkeletonMolecule shape='section' />;
  }
  if (data.status === 'error') {
    return (
      <AccountLoadErrorMolecule
        onRetry={data.retry}
        isRetrying={data.isRetrying}
      />
    );
  }

  return (
    <div className={styles.page}>
      {shell === 'rail' && <AppHeroOrganism title={label} />}
      <AccountSectionPanelOrganism
        section={section}
        data={data}
        withAccountWideCards={shell === 'rail'}
      />
    </div>
  );
}

export function AccountSectionPageComposition({
  section,
}: {
  section: AccountSectionId;
}) {
  const tSections = useTranslations(ACCOUNT_SECTIONS_I18N_NAMESPACE);
  return (
    <AppLayoutComposition
      title={tSections(getAccountSectionDef(section).labelKey)}>
      <AccountSectionViewComposition section={section} />
    </AppLayoutComposition>
  );
}
