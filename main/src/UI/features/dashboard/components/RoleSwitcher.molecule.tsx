// UI/features/dashboard/components/RoleSwitcher.molecule.tsx
// Switches the user's active role (Stylist | Client) through the shared
// SegmentedControlMolecule.
// Only rendered for dual-role users (see DashboardPage). Reads the current role
// from the BA session (useAuth().accountType); a click on the inactive segment
// fires useSwitchRole().mutate with the opposite account_type. The dashboard
// re-renders the correct variant once the session atom refetches — zero nav.
//
// The hand-rolled track and thumb are gone (one segmented control in the product), and the label
// has one line saying what the switch does: „Aktywny tryb” alone did not explain itself (owner
// walkthrough).

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CircleNotchIcon } from '@phosphor-icons/react';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import type { AccountType } from '@kernel/models/db_models.generated.dto';
import { useAuth } from '../../../contexts/AuthContext.composition';
import { useSwitchRole } from '../../shared/hooks/useSwitchRole';
import { SegmentedControlMolecule } from '../../../components/SegmentedControl/SegmentedControl.molecule';
import styles from './RoleSwitcher.module.css';
import pageStyles from '../DashboardPage.module.css';

export function RoleSwitcherMolecule() {
  const t = useTranslations('dashboard.roleSwitcher');
  const { accountType } = useAuth();
  const [feedback, setFeedback] = useState('');
  const { mutate, isPending } = useSwitchRole();

  // Without a current role (session not hydrated yet) we do not render — the caller gates on both
  // accounts anyway, but this protects against segment flicker.
  if (accountType === null) {
    return null;
  }

  const current: AccountType = accountType;

  const select = (target: AccountType) => {
    if (isPending || target === current) {
      return;
    }
    // `target` is the clicked (inactive) segment — with a 2-state toggle it is always the opposite of
    // `current`, so we send it as is (load-bearing param, no opposite-of-current middleman).
    mutate(
      { account_type: target },
      {
        onSuccess: () => {
          setFeedback(
            target === AccountTypeValue.STYLIST
              ? t('switchedToStylist')
              : t('switchedToClient')
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
    <section
      className={`${pageStyles.section} ${styles.wrap}`}
      data-app-section='plain'
      aria-busy={isPending || undefined}>
      <h2 className={pageStyles.sectionTitle} data-app-section-title=''>
        {t('title')}
      </h2>
      {/* DECISION: the hint says which account she is on NOW and what she can do there, so
          there are two keys (hintStylist / hintClient) because the sentence depends on the
          active account. (owner) */}
      <p className={styles.hint}>
        {t(current === AccountTypeValue.STYLIST ? 'hintStylist' : 'hintClient')}
      </p>
      <span className='sr-only' role='status' aria-live='polite'>
        {feedback}
      </span>
      <SegmentedControlMolecule<AccountType>
        className={styles.switcher}
        value={current}
        onChange={select}
        ariaLabel={t('title')}
        optionClassName='press-feedback'
        options={[
          option(AccountTypeValue.STYLIST, t('stylist')),
          option(AccountTypeValue.CLIENT, t('client')),
        ]}
      />
    </section>
  );
}
