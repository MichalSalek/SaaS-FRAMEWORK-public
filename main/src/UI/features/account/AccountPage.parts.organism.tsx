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
 * Karty rolowe konta — wyniesione z kompozycji 2026-09-09
 * (limit modularności 300 linii). Trzy niezależne komunikaty, każdy sterowany
 * WYŁĄCZNIE polem z `account-surface.policy`, więc reguła „co widać w którym
 * trybie" ma jedno źródło i nie rozłazi się po JSX-ie.
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
    <article className={styles.crossRoleCard}>
      <div className={styles.crossRoleBody}>
        <TypographyAtom variant='h4'>{t('profileLinkTitle')}</TypographyAtom>
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
        <article className={styles.crossRoleCard}>
          <div className={styles.crossRoleBody}>
            <TypographyAtom variant='h4'>{t('dualClientTitle')}</TypographyAtom>
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
        <article className={styles.crossRoleCard}>
          <div className={styles.crossRoleBody}>
            <TypographyAtom variant='h4'>
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

      {/* Dwurolowy user W TRYBIE KLIENTKI: sekcje stylistki są ukryte
        celowo (account-surface.policy), więc ekran musi powiedzieć,
        GDZIE one są — inaczej wygląda jak zgubione ustawienia. */}
      {surface.offerRoleSwitchTo === AccountTypeValue.STYLIST && (
        <article className={styles.crossRoleCard}>
          <div className={styles.crossRoleBody}>
            <TypographyAtom variant='h4'>
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
 * DECISION (nie usuwaj tego komentarza) — owner 2026-10-08:
 * stało w „Strefie krytycznej” jako karta „Konto oznaczone do usunięcia?”
 * i przy aktywnym koncie czytało się jak alarm. To nie jest operacja groźna,
 * tylko wejście do ekranu statusu, więc mieszka w sekcji „Dane” (obok kopii
 * danych: obie rzeczy mówią, co dzieje się z kontem i jego zawartością) jako
 * jeden cichy wiersz nawigacyjny.
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
