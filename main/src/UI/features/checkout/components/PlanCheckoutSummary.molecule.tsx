// UI/features/checkout/components/PlanCheckoutSummary.molecule.tsx
// SPE (W2): order summary inside the embedded checkout — plan name + icon
// (from usePricingPlans, the runtime pricing SSOT) + Stripe-provided total
// (preformatted, locale-correct) + an optional trial risk-reduction note.

import { CircleNotchIcon, ShieldCheckIcon } from '@phosphor-icons/react';
import {
  getPlanDisplayName,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import { usePricingPlans } from '../../shared/pricing/hooks/usePricingPlans';
import styles from '../PlanCheckoutPanel.module.css';

export interface PlanCheckoutSummaryTranslations {
  cycleMonthly: string;
  cycleYearly: string;
  totalLabel: string;
  /** Faktura VAT — etykieta kwoty netto (Netto / Net / Netto). */
  netLabel: string;
  /** Faktura VAT — etykieta kwoty VAT (np. "VAT 23%"). */
  vatLabel: string;
  /** Faktura VAT — etykieta kwoty brutto (Brutto / Gross / Brutto). */
  grossLabel: string;
  /** Trial note title, e.g. "30 dni za darmo". */
  trialTitle: string;
  /** Trial note subtitle — reassures the card is only charged after the trial. */
  trialSub: string;
}

interface PlanCheckoutSummaryProps {
  planId: PricingPlan;
  billingPeriod: BillingPeriod;
  /**
   * Faktura VAT — rozbicie ceny ze Stripe `checkout.total` (Stripe LICZY, front
   * tylko WYŚWIETLA; każde `.amount` = sformatowany, locale-correct string):
   *   netFormatted   = `checkout.total.subtotal.amount`     (NETTO)
   *   vatFormatted   = `checkout.total.taxExclusive.amount` (kwota VAT 23%)
   *   grossFormatted = `checkout.total.total.amount`        (BRUTTO, do zapłaty)
   */
  netFormatted: string;
  vatFormatted: string;
  grossFormatted: string;
  /** Show the trial reassurance note (paid plan claimed via trial). */
  showTrialNote: boolean;
  /**
   * id stamped on the summary section so the parent dialog can point its
   * aria-describedby at it (the transaction the dialog is about). Optional —
   * the summary renders identically without it.
   */
  summaryDescribedById?: string | undefined;
  tx: PlanCheckoutSummaryTranslations;
}

// DECISION (nie usuwaj tego komentarza):
// Zwraca rodzeństwo (summary + opcjonalny trialNote) BEZ własnego `.panel` —
// rodzic (CheckoutForm) już owija je w `.panel` (jego `gap` rozkłada odstępy).
// Wcześniejszy wewnętrzny `.panel` był redundantną warstwą DOM z drugim `gap`.
export function PlanCheckoutSummaryMolecule({
  planId,
  billingPeriod,
  netFormatted,
  vatFormatted,
  grossFormatted,
  showTrialNote,
  summaryDescribedById,
  tx,
}: PlanCheckoutSummaryProps) {
  const { data: plans } = usePricingPlans();
  const plan = plans?.find(p => p.id === planId);
  const Icon = plan?.icon ?? CircleNotchIcon;
  const cycleLabel =
    billingPeriod === 'year' ? tx.cycleYearly : tx.cycleMonthly;

  return (
    <>
      <section
        className={styles.summary}
        aria-label={tx.totalLabel}
        {...(summaryDescribedById !== undefined && {
          id: summaryDescribedById,
        })}>
        <div className={styles.summaryRow}>
          <div className={styles.summaryPlan}>
            <span className={styles.summaryPlanIcon} aria-hidden='true'>
              <Icon size={18} weight='duotone' />
            </span>
            <div>
              {/* The plans read is a background query (no toast), so a failed
                  fetch left the name blank; the name itself is kernel data. */}
              <div className={styles.summaryPlanName}>
                {plan?.name ?? getPlanDisplayName(planId)}
              </div>
              <div className={styles.summaryPlanCycle}>{cycleLabel}</div>
            </div>
          </div>
        </div>

        <hr className={styles.summaryDivider} />

        {/* Faktura VAT: rozbicie netto / VAT 23% / brutto (Stripe liczy). */}
        <div className={styles.summaryLineRow}>
          <span className={styles.summaryLineLabel}>{tx.netLabel}</span>
          <span className={styles.summaryLineAmount}>{netFormatted}</span>
        </div>
        <div className={styles.summaryLineRow}>
          <span className={styles.summaryLineLabel}>{tx.vatLabel}</span>
          <span className={styles.summaryLineAmount}>{vatFormatted}</span>
        </div>

        <hr className={styles.summaryDivider} />

        <div className={styles.summaryTotalRow}>
          <span className={styles.summaryTotalLabel}>{tx.grossLabel}</span>
          <span className={styles.summaryTotalAmount}>{grossFormatted}</span>
        </div>
      </section>

      {showTrialNote && (
        <section className={styles.trialNote}>
          <ShieldCheckIcon
            size={20}
            weight='duotone'
            className={styles.trialNoteIcon}
            aria-hidden='true'
          />
          <div className={styles.trialNoteText}>
            <span className={styles.trialNoteTitle}>{tx.trialTitle}</span>
            <span className={styles.trialNoteSub}>{tx.trialSub}</span>
          </div>
        </section>
      )}
    </>
  );
}
