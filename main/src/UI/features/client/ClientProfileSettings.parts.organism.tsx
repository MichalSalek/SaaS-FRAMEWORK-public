// UI/features/client/ClientProfileSettings.parts.organism.tsx
// „Where next” rows of the client's profile: her sessions and her account.
//
// DECISION (nie usuwaj tego komentarza) — przegląd oczami użytkownika,
// 2026-10-09: trzeci wiersz „Odzyskiwanie konta / Dostęp i usuwanie konta”
// został usunięty. Prowadził do ekranu statusu zamkniętego konta, do którego
// to samo wejście stoi w „Zarządzaj kontem” (sekcja „Dane”, tam pod nazwą
// „Przywracanie konta”), a jego opis obiecywał usuwanie konta, którego na tym
// ekranie nie ma. Jedna rzecz, jedna nazwa, jedne drzwi.

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
