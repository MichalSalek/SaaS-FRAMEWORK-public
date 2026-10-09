// UI/features/dashboard/components/RoleSwitcher.molecule.tsx
// Switches the user's active role (Stylist | Client) through the shared
// SegmentedControlMolecule.
// Only rendered for dual-role users (see DashboardPage). Reads the current role
// from the BA session (useAuth().accountType); a click on the inactive segment
// fires useSwitchRole().mutate with the opposite account_type. The dashboard
// re-renders the correct variant once the session atom refetches — zero nav.
//
// S126: the hand-rolled track and thumb went away (one segmented control in
// the product), and the label gained one line saying what the switch does:
// „Aktywny tryb” alone did not explain itself (owner walkthrough 2026-10-08).

import { useTranslations } from 'next-intl';
import { CircleNotchIcon } from '@phosphor-icons/react';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import type { AccountType } from '@kernel/models/db_models.generated.dto';
import { useAuth } from '../../../contexts/AuthContext.composition';
import { useSwitchRole } from '../../shared/hooks/useSwitchRole';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { SegmentedControlMolecule } from '../../../components/SegmentedControl/SegmentedControl.molecule';
import styles from './RoleSwitcher.module.css';

export function RoleSwitcherMolecule() {
  const t = useTranslations('dashboard.roleSwitcher');
  const { accountType } = useAuth();
  const { mutate, isPending } = useSwitchRole();

  // Bez bieżącej roli (sesja jeszcze nie zhydratowana) nie renderujemy — caller
  // i tak gate'uje na obu kontach, ale to chroni przed migotaniem segmentów.
  if (accountType === null) {
    return null;
  }

  const current: AccountType = accountType;

  const select = (target: AccountType) => {
    if (isPending || target === current) {
      return;
    }
    // `target` to kliknięty (nieaktywny) segment — przy 2-stanowym toggle jest
    // zawsze przeciwieństwem `current`, więc wysyłamy go wprost (param load-bearing,
    // bez pośrednika opposite-of-current).
    mutate(
      { account_type: target },
      {
        // Sukces ogłaszany przez aria-live (Sonner) — to JEDYNY feedback po
        // zmianie roli: sam re-render dashboardu jest niemy dla czytnika ekranu.
        // DECISION (nie usuwaj): lokalny push ZOSTAJE mimo że błędy toastuje
        // HTTP-interceptor (event-bus Stage 1). USER_ROLE_SWITCHED jest w
        // eventsDisallowedForUI → interceptor MILCZY na sukcesie, więc bez tego
        // pushu sukces byłby niemy. Ścieżka błędu = wyłącznie interceptor
        // (lokalny onError usunięty — dublował toast interceptora).
        onSuccess: () => {
          pushNewSnackbar(
            target === AccountTypeValue.STYLIST
              ? t('switchedToStylist')
              : t('switchedToClient'),
            'success'
          );
        },
      }
    );
  };

  // While the switch is in flight the TARGET segment says so; the control
  // itself stays on the current role until the session confirms the change.
  const target: AccountType =
    current === AccountTypeValue.STYLIST
      ? AccountTypeValue.CLIENT
      : AccountTypeValue.STYLIST;
  const option = (value: AccountType, label: string) =>
    isPending && value === target
      ? {
          value,
          label: t('switching'),
          icon: <CircleNotchIcon size={16} className={styles.spinner} />,
        }
      : { value, label };

  return (
    <section className={styles.wrap} aria-busy={isPending || undefined}>
      <h2 className={styles.title}>{t('title')}</h2>
      {/* DECISION (nie usuwaj tego komentarza) — owner 2026-10-09: podpowiedź
          mówi, na którym koncie jest TERAZ i co w tym miejscu może zrobić.
          Poprzednia („Masz oba konta. Wybierz, w którym teraz pracujesz.”) była
          kalką z angielskiego: „sucha, mechaniczna i dziwna w odbiorze”. Dwa
          klucze, bo zdanie zależy od aktywnego konta. */}
      <p className={styles.hint}>
        {t(current === AccountTypeValue.STYLIST ? 'hintStylist' : 'hintClient')}
      </p>
      <SegmentedControlMolecule<AccountType>
        value={current}
        onChange={select}
        ariaLabel={t('title')}
        optionClassName='haptic-press'
        options={[
          option(AccountTypeValue.STYLIST, t('stylist')),
          option(AccountTypeValue.CLIENT, t('client')),
        ]}
      />
    </section>
  );
}
