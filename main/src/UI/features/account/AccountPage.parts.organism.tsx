// UI/features/account/AccountPage.parts.organism.tsx
// Composable cards of the account settings screens: the public-profile link,
// the role cards (second account, switch of the active role) and the quiet
// entry to account recovery.
// DangerZonePanel lives in AccountPage.dangerZone.organism.tsx to keep both
// files under the 300 LOC ceiling.
// Stack: TQ v5 + CSS Modules + Phosphor Icons.

import { useTranslations } from 'next-intl';
import { LifebuoyIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import type { AccountSurface } from '../../../application/policies/account-surface.policy';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../components/NavRow/NavRow.molecule';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { useSwitchRole } from '../shared/hooks/useSwitchRole';
import styles from './AccountPage.module.css';

export { DangerZonePanelOrganism } from './AccountPage.dangerZone.organism';

/* ============================================================
 * Karta „Twój publiczny profil" — konfiguracja wizytówki wyprowadzona
 * 2026-09-09 na własną trasę (/app/profile); w koncie zostaje wskazówka, gdzie
 * ona jest. Powód: sekcja wciśnięta w ustawienia konta była nieznajdowalna,
 * a przypinania zdjęć nie miała wcale.
 * ============================================================ */

/* ============================================================
 * Role cards of the account screen, split out of the composition (300-line
 * module limit). Three independent messages, each driven ONLY by a field of
 * `account-surface.policy`, so the rule "what shows in which mode" has one
 * source and does not spread through the JSX.
 * ============================================================ */

export function AccountProfileLinkCardOrganism({
  visible,
}: {
  visible: boolean;
}) {
  const t = useTranslations('account.page');
  if (!visible) {
    return null;
  }
  return (
    <article className={styles.crossRoleCard} data-app-section='bordered'>
      <div className={styles.crossRoleBody}>
        <TypographyAtom variant='h4' data-app-section-title=''>
          {t('profileLinkTitle')}
        </TypographyAtom>
        <TypographyAtom variant='body2' color='var(--color-text-secondary)'>
          {t('profileLinkBody')}
        </TypographyAtom>
      </div>
      <LinkButtonAtom
        href={ROUTES_FRONT.STYLIST_PROFILE_MANAGE}
        variant='outlined'
        size='md'>
        {t('profileLinkCta')}
      </LinkButtonAtom>
    </article>
  );
}

export function AccountRoleCardsOrganism({
  surface,
}: {
  surface: AccountSurface;
}) {
  const t = useTranslations('account.page');
  const switchRole = useSwitchRole();
  return (
    <>
      {/* Dual-account discovery — visible only when user has one role */}
      {surface.offerMissingRole === AccountTypeValue.CLIENT && (
        <article className={styles.crossRoleCard} data-app-section='bordered'>
          <div className={styles.crossRoleBody}>
            <TypographyAtom variant='h4' data-app-section-title=''>
              {t('dualClientTitle')}
            </TypographyAtom>
            <TypographyAtom variant='body2' color='var(--color-text-secondary)'>
              {t('dualClientBody')}
            </TypographyAtom>
          </div>
          <LinkButtonAtom
            href={ROUTES_FRONT.USER_ACTIVATE_CLIENT}
            variant='outlined'
            size='md'>
            {t('dualClientCta')}
          </LinkButtonAtom>
        </article>
      )}
      {surface.offerMissingRole === AccountTypeValue.STYLIST && (
        <article className={styles.crossRoleCard} data-app-section='bordered'>
          <div className={styles.crossRoleBody}>
            <TypographyAtom variant='h4' data-app-section-title=''>
              {t('dualStylistTitle')}
            </TypographyAtom>
            <TypographyAtom variant='body2' color='var(--color-text-secondary)'>
              {t('dualStylistBody')}
            </TypographyAtom>
          </div>
          <LinkButtonAtom
            href={ROUTES_FRONT.USER_ACTIVATE_STYLIST}
            variant='primary'
            size='md'>
            {t('dualStylistCta')}
          </LinkButtonAtom>
        </article>
      )}

      {/* Dual-role user IN CLIENT MODE: the stylist sections are hidden on
        purpose (account-surface.policy), so the screen must say WHERE they
        are, else it looks like lost settings. */}
      {surface.offerRoleSwitchTo === AccountTypeValue.STYLIST && (
        <article className={styles.crossRoleCard} data-app-section='bordered'>
          <div className={styles.crossRoleBody}>
            <TypographyAtom variant='h4' data-app-section-title=''>
              {t('switchToStylistTitle')}
            </TypographyAtom>
            <TypographyAtom variant='body2' color='var(--color-text-secondary)'>
              {t('switchToStylistBody')}
            </TypographyAtom>
          </div>
          <ButtonAtom
            variant='outlined'
            size='md'
            disabled={switchRole.isPending}
            onClick={() =>
              switchRole.mutate({
                account_type: AccountTypeValue.STYLIST,
              })
            }>
            {switchRole.isPending
              ? t('switchToStylistPending')
              : t('switchToStylistCta')}
          </ButtonAtom>
        </article>
      )}
    </>
  );
}

/* ============================================================
 * Wejście do przywracania konta.
 *
 * DECISION: the entry to account recovery lives in the "Dane" section (beside the data copy: both
 * say what happens to the account and its content) as one quiet navigation row. It used to be the
 * card "Konto oznaczone do usunięcia?" in the critical zone and read as an alarm on an active
 * account; it is not a dangerous operation, only the entry to a status screen. (owner)
 * ============================================================ */

export function AccountRecoveryEntryOrganism() {
  const t = useTranslations('account.page');
  return (
    <NavRowListMolecule ariaLabel={t('recoveryEntryLabel')}>
      <NavRowMolecule
        href={ROUTES_FRONT.USER_RECOVER}
        icon={<LifebuoyIcon size={22} weight='regular' />}
        label={t('recoveryEntryLabel')}
        description={t('recoveryEntryDesc')}
        trailing='chevron'
      />
    </NavRowListMolecule>
  );
}
