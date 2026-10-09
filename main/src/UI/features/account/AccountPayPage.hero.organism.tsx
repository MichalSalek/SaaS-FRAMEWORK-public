// UI/features/account/AccountPayPage.hero.organism.tsx
// What sits between the intro and the plan cards: the billing card of a paid
// plan (what happens next with the subscription + the portal button) and the
// header of the plan list with the billing-period switch.
// The intro itself is the canonical <AppHeroOrganism>, mounted by the
// composition.

import { WarningCircleIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../components/Button/Button.atom';
import type { BillingCycle } from '../../components/BillingToggle/BillingToggle.molecule';
import { SegmentedControlMolecule } from '../../components/SegmentedControl/SegmentedControl.molecule';
import styles from './AccountPayPage.module.css';

/* ============================================================
 *  BILLING CARD — paid plans only
 * ============================================================ */

interface BillingCardProps {
  /** The dated fact: next payment, trial end, access end, failed payment. */
  title: string;
  /** One sentence: what follows from it. */
  body: string;
  /** A failed payment: the icon carries the alarm, not a tinted card. */
  isAlert: boolean;
  manageLabel: string;
  onManage: () => void;
  isManaging: boolean;
  /** The screen's filled action when no plan card has it. */
  isPrimary: boolean;
  /** Degraded (Stripe fallback): the portal would fail too. */
  disabled: boolean;
  /** The billing portal did not open: said under the button. */
  error?: string;
}

// DECISION (nie usuwaj tego komentarza) — S126:
// The plan name is NOT repeated here. The intro already says „Twój plan:
// Studio”; before, the same fact stood in the title, in this card („Plan
// aktywny / Studio”) and in a sentence under both. The card carries only what
// the intro does not: the next date and the one billing action. Free has no
// subscription to manage, so it renders no card at all (a dead grey button
// was friction without a reason).
export function BillingCardOrganism({
  title,
  body,
  isAlert,
  manageLabel,
  onManage,
  isManaging,
  isPrimary,
  disabled,
  error,
}: BillingCardProps) {
  return (
    <section className={styles.billingCard}>
      <div className={styles.billingText}>
        <p className={styles.billingTitle}>
          {isAlert && (
            <WarningCircleIcon
              size={20}
              weight='fill'
              className={styles.billingAlertIcon}
              aria-hidden='true'
            />
          )}
          <span>{title}</span>
        </p>
        <p className={styles.billingBody}>{body}</p>
      </div>
      {/* Full width of the card at every size, and the label stays put while
          the portal opens: the spinner arrives, nothing changes width. */}
      <ButtonAtom
        variant={isPrimary ? 'primary' : 'outlined'}
        size='lg'
        className={styles.billingBtn}
        onClick={onManage}
        disabled={isManaging || disabled}
        loading={isManaging}>
        {manageLabel}
      </ButtonAtom>
      {error !== undefined && (
        <p className={styles.actionError} role='alert'>
          {error}
        </p>
      )}
    </section>
  );
}

/* ============================================================
 *  PLAN LIST HEADER — title + billing period
 * ============================================================ */

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

export function PlansHeaderMolecule({
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
              label: (
                <span className={styles.periodYearly}>
                  {yearlyLabel}
                  {/* A symbol, not a per-plan figure: the same approximation
                      the public pricing page shows. Selected option is ink, so
                      the badge flips to paper there and stays readable. */}
                  <span
                    className={styles.saveBadge}
                    data-on-ink={cycle === 'yearly' || undefined}>
                    -20%
                  </span>
                </span>
              ),
            },
          ]}
        />
      </div>
      <p className={styles.periodHint}>{hint}</p>
    </header>
  );
}
