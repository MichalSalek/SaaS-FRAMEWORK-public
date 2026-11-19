// UI/features/client/ClientProfileSettings.parts.organism.tsx
// „Where next” rows of the client's profile: her sessions and her account.
//
// DECISION: the third row "Odzyskiwanie konta / Dostęp i usuwanie konta" is gone. It led to the
// closed-account status screen, whose entry already stands in "Zarządzaj kontem" (section "Dane",
// named "Przywracanie konta"), and its description promised account deletion, which this screen
// does not have. One thing, one name, one door. (owner)

import { useTranslations } from 'next-intl';
import { GearSixIcon, ImagesIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../components/NavRow/NavRow.molecule';

export function SettingsShortcutsOrganism() {
  const t = useTranslations('pages.clientProfile');
  return (
    <NavRowListMolecule label={t('settingsTitle')}>
      <NavRowMolecule
        href={ROUTES_FRONT.CLIENT_SESSIONS}
        icon={<ImagesIcon size={22} />}
        label={t('settingsSessionsLabel')}
        description={t('settingsSessionsDesc')}
        trailing='disc'
      />
      <NavRowMolecule
        href={ROUTES_FRONT.USER_ACCOUNT}
        icon={<GearSixIcon size={22} />}
        label={t('settingsAccountLabel')}
        description={t('settingsAccountDesc')}
        trailing='disc'
      />
    </NavRowListMolecule>
  );
}
