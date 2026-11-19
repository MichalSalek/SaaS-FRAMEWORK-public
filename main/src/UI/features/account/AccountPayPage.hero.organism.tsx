// UI/features/account/AccountPayPage.hero.organism.tsx
// Header of the plan-change catalog with its billing-period switch.
// Current billing facts and portal actions live in the Plan settings section.
// The intro itself is the canonical <AppHeroOrganism>, mounted by the
// composition.

import type { BillingCycle } from '../../components/BillingToggle/BillingToggle.molecule';
import { SegmentedControlMolecule } from '../../components/SegmentedControl/SegmentedControl.molecule';
import styles from './AccountPayPage.module.css';

interface PlansHeaderProps {
  title: string;
  cycle: BillingCycle;
  onCycleChange: (cycle: BillingCycle) => void;
  monthlyLabel: string;
  yearlyLabel: string;
  /** Names the switch for assistive tech. */
  periodLabel: string;
  hint: string;
}

export function PlansHeaderOrganism({
  title,
  cycle,
  onCycleChange,
  monthlyLabel,
  yearlyLabel,
  periodLabel,
  hint,
}: PlansHeaderProps) {
  return (
    <header className={styles.plansHeader}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <div className={styles.periodSwitch}>
        <SegmentedControlMolecule<BillingCycle>
          value={cycle}
          onChange={onCycleChange}
          ariaLabel={periodLabel}
          fullWidth
          options={[
            { value: 'monthly', label: monthlyLabel },
            {
              value: 'yearly',
              label: yearlyLabel,
            },
          ]}
        />
      </div>
      <p className={styles.periodHint}>{hint}</p>
    </header>
  );
}
