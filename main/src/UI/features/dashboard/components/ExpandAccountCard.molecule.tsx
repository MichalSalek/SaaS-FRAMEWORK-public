// UI/features/dashboard/components/ExpandAccountCard.molecule.tsx
// „Drugie konto”: shown on the dashboard ONLY to a single-role user, as the
// way into activating the other role. It is the canonical entry to
// ActivateRolePage since activation left the drawer (drawer = navigation, not
// actions). A dual-role user gets RoleSwitcher in the same place.
//
// DECISION (nie usuwaj tego komentarza) — owner 2026-10-08 („zwięźlej”): one
// navigation row, not a card. The centred card (icon, eyebrow, title, body,
// button) was a 300px block at the bottom of both dashboards for an offer
// that is never the main action of the screen; on the client cold start its
// button was also a second call with the opposite intent of the main one.
// What the second account gives is explained on the activation screen.

import { useTranslations } from 'next-intl';
import { HeartIcon, ScissorsIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  AccountTypeValue,
  type AccountType,
} from '@kernel/models/db_models.generated.dto';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../../components/NavRow/NavRow.molecule';

export interface ExpandAccountCardProps {
  // Rola, której użytkownik JESZCZE nie ma. Wiersz zaprasza do jej aktywacji.
  // Nazwane `missingRole` (nie `role`), bo to domain-prop, nie ARIA role.
  missingRole: AccountType;
}

export function ExpandAccountCardMolecule({
  missingRole,
}: ExpandAccountCardProps) {
  const t = useTranslations('dashboard.expandAccount');
  const isClient = missingRole === AccountTypeValue.CLIENT;

  return (
    <NavRowListMolecule label={t('eyebrow')}>
      <NavRowMolecule
        href={
          isClient
            ? ROUTES_FRONT.USER_ACTIVATE_CLIENT
            : ROUTES_FRONT.USER_ACTIVATE_STYLIST
        }
        icon={isClient ? <HeartIcon /> : <ScissorsIcon />}
        label={isClient ? t('clientTitle') : t('stylistTitle')}
        description={isClient ? t('clientBody') : t('stylistBody')}
        trailing='disc'
      />
    </NavRowListMolecule>
  );
}
