// UI/features/checkout/components/PlanCheckoutSummary.molecule.tsx
// SPE (W2): the order summary inside the embedded checkout, the last thing she
// reads before the card form.
//
// DECISION: two charges, two blocks. What is charged TODAY and what is charged every period are
// different amounts whenever a trial starts, so each block takes ALL its figures from one Stripe
// object (checkout-summary.helpers.ts); a net from one and a VAT from the other gave "Netto 179,00
// zł / VAT 0,00 zł / Brutto 0,00 zł". Whether a trial starts is read from the SESSION Stripe
// returned, not from the account cache, so the summary can never promise a trial the session does
// not carry. A figure Stripe did not give is said to be missing; it is never printed as 0,00.
// (owner)

import {
  CheckIcon,
  CircleNotchIcon,
  ShieldCheckIcon,
} from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import {
  getPlanDisplayName,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { formatDateLong } from '../../../../application/date/date.utils';
import { useCurrentLang } from '../../../hooks/useCurrentLang';
import { usePricingPlans } from '../../shared/pricing/hooks/usePricingPlans';
import { useCheckoutPlanHighlights } from '../hooks/useCheckoutPlanHighlights';
import type {
  ChargeFigure,
  CheckoutSummaryModel,
  SummaryDiscount,
} from '../checkout-summary.helpers';
import styles from '../PlanCheckoutPanel.module.css';

export interface PlanCheckoutSummaryTranslations {
  cycleMonthly: string;
  cycleYearly: string;
  totalLabel: string;
  /** Faktura VAT — etykieta kwoty netto (Netto / Net / Netto). */
  netLabel: string;
  /** VAT label WITHOUT a rate, used when the rate cannot be read from Stripe. */
  vatLabel: string;
  /** Faktura VAT — etykieta kwoty brutto (Brutto / Gross / Brutto). */
  grossLabel: string;
  /** Card note title: today the card is not charged. */
  trialTitle: string;
  /** Card note body: why the card is asked for now. */
  trialSub: string;
}

interface PlanCheckoutSummaryProps {
  addressReady?: boolean;
  currency?: string;
  planId: PricingPlan;
  /** Today's charge and the recurring charge, each from its own Stripe object. */
  model: CheckoutSummaryModel;
  /**
   * id stamped on the summary section so the parent dialog can point its
   * aria-describedby at it (the transaction the dialog is about). Optional —
   * the summary renders identically without it.
   */
  summaryDescribedById?: string | undefined;
  tx: PlanCheckoutSummaryTranslations;
}

type SummaryT = ReturnType<typeof useTranslations<'account.checkout.summary'>>;

/** A date or an amount never breaks inside. */
const whole = (text: string): string => text.replaceAll(' ', ' ');

function discountLabel(discount: SummaryDiscount, s: SummaryT): string {
  // A coupon without a name leaves „Rabat” alone, never a doubled space.
  return discountLabelRaw(discount, s).replace(/\s+/g, ' ').trim();
}

function discountLabelRaw(discount: SummaryDiscount, s: SummaryT): string {
  const name = discount.name ?? '';
  switch (discount.duration?.type) {
    case 'once':
      return s('discountOnce', { name });
    case 'forever':
      return s('discountForever', { name });
    case 'months':
      return s('discountMonths', { name, months: discount.duration.months });
    default:
      return s('discountPlain', { name });
  }
}

/** Stripe charge parts; inclusive VAT is informational, never added again. */
function BreakdownRows({
  figure,
  s,
  tx,
}: {
  figure: ChargeFigure;
  s: SummaryT;
  tx: PlanCheckoutSummaryTranslations;
}) {
  if (figure.kind === 'inclusive') {
    return (
      <>
        {figure.discount !== null && (
          <>
            <div className={styles.summaryLineRow}>
              <span className={styles.summaryLineLabel}>
                {s('grossBeforeDiscount')}
              </span>
              <span className={styles.summaryLineAmount}>
                {figure.beforeDiscountGross}
              </span>
            </div>
            <div className={styles.summaryLineRow}>
              <span className={styles.summaryLineLabel}>
                {discountLabel(figure.discount, s)}
              </span>
              <span className={styles.summaryLineAmount}>
                {figure.discount.amount}
              </span>
            </div>
          </>
        )}
        <div className={styles.summaryLineRow}>
          <span className={styles.summaryLineLabel}>
            {figure.vatRatePercent !== null
              ? s('includedVatRateLabel', { rate: figure.vatRatePercent })
              : s('includedVatLabel')}
          </span>
          <span className={styles.summaryLineAmount}>{figure.vat}</span>
        </div>
      </>
    );
  }
  if (figure.kind !== 'breakdown') {
    return null;
  }
  return (
    <>
      <div className={styles.summaryLineRow}>
        <span className={styles.summaryLineLabel}>{tx.netLabel}</span>
        <span className={styles.summaryLineAmount}>{figure.net}</span>
      </div>
      {figure.discount !== null && (
        <div className={styles.summaryLineRow}>
          <span className={styles.summaryLineLabel}>
            {discountLabel(figure.discount, s)}
          </span>
          <span className={styles.summaryLineAmount}>
            {figure.discount.amount}
          </span>
        </div>
      )}
      <div className={styles.summaryLineRow}>
        <span className={styles.summaryLineLabel}>
          {figure.vatRatePercent !== null
            ? s('vatRateLabel', { rate: figure.vatRatePercent })
            : tx.vatLabel}
        </span>
        <span className={styles.summaryLineAmount}>{figure.vat}</span>
      </div>
    </>
  );
}

// Returns siblings (summary + optional card note) without its own `.panel`: the parent
// (CheckoutForm) already wraps them in one and its `gap` spaces them.
export function PlanCheckoutSummaryMolecule({
  planId,
  model,
  summaryDescribedById,
  tx,
  addressReady = true,
  currency,
}: PlanCheckoutSummaryProps) {
  const s = useTranslations('account.checkout.summary');
  const c = useTranslations('account.checkout');
  const locale = useCurrentLang();
  const { data: plans } = usePricingPlans();
  const highlights = useCheckoutPlanHighlights(planId);
  const plan = plans?.find(p => p.id === planId);
  const Icon = plan?.icon ?? CircleNotchIcon;
  // The plans read is a background query (no toast), so a failed fetch left the
  // name blank; the name itself is kernel data.
  const planName = plan?.name ?? getPlanDisplayName(planId);
  const isTrial = model.kind === 'trial';
  const cycleLabel =
    model.interval === 'year' ? tx.cycleYearly : tx.cycleMonthly;

  if (!addressReady) {
    return <p role='status'>{c('fillBillingAddress')}</p>;
  }

  const header = (
    <div className={styles.summaryRow}>
      <div className={styles.summaryPlan}>
        <span className={styles.summaryPlanIcon} aria-hidden='true'>
          <Icon size={18} weight='duotone' />
        </span>
        <div>
          <div className={styles.summaryPlanName}>{planName}</div>
          <div className={styles.summaryPlanCycle}>
            {isTrial ? s('planTrialLine') : cycleLabel}
            {currency && ` (${currency.toUpperCase()})`}
          </div>
        </div>
      </div>
    </div>
  );

  const sectionProps = {
    className: styles.summary,
    'aria-label': tx.totalLabel,
    ...(summaryDescribedById !== undefined && { id: summaryDescribedById }),
  };

  if (model.kind === 'pay') {
    return (
      <section {...sectionProps}>
        {header}
        <hr className={styles.summaryDivider} />
        <BreakdownRows figure={model.today} s={s} tx={tx} />
        {(model.today.kind === 'breakdown' ||
          model.today.kind === 'inclusive') && (
          <hr className={styles.summaryDivider} />
        )}
        {/* An unknown amount never reaches here: the form stops before it. */}
        {model.today.kind !== 'unavailable' && (
          <div className={styles.summaryTotalRow}>
            <span className={styles.summaryTotalLabel}>
              {s('todayGrossLabel')}
            </span>
            <span className={styles.summaryTotalAmount}>
              {model.today.gross}
            </span>
          </div>
        )}
        {model.nextGross !== null && (
          <p className={styles.summaryNote}>
            {s('nextPayments', {
              amount: whole(model.nextGross),
              interval: model.interval,
            })}
          </p>
        )}
      </section>
    );
  }

  const trialEnd = whole(formatDateLong(model.trialEndsAt, locale));

  return (
    <>
      <section {...sectionProps}>
        {header}
        <hr className={styles.summaryDivider} />

        {/* Block 1: today's charge, with the reason it is zero. */}
        <div className={styles.summaryTotalRow}>
          <span className={styles.summaryTotalLabel}>{s('todayLabel')}</span>
          <span className={styles.summaryTotalAmount}>{model.todayGross}</span>
        </div>
        <p className={styles.summaryLead}>
          {s('trialReason', { days: model.trialDays, date: trialEnd })}
        </p>

        {highlights.length > 0 && (
          <>
            <hr className={styles.summaryDivider} />
            <h3 className={styles.summaryBlockTitle}>
              {s('featuresTitle', { plan: planName })}
            </h3>
            <ul className={styles.summaryFeatures}>
              {highlights.map(feature => (
                <li key={feature} className={styles.summaryFeature}>
                  <CheckIcon
                    size={16}
                    weight='bold'
                    className={styles.summaryFeatureIcon}
                    aria-hidden='true'
                  />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        <hr className={styles.summaryDivider} />

        {/* Block 2: the recurring charge = the first payment after the trial. */}
        <h3 className={styles.summaryBlockTitle}>{s('afterTitle')}</h3>
        {model.next.kind === 'unavailable' ? (
          <p className={styles.summaryNote}>
            {s('firstPaymentUnavailable', { date: trialEnd })}
          </p>
        ) : (
          <>
            <p className={styles.summaryNote}>
              {s('firstPayment', { date: trialEnd, interval: model.interval })}
            </p>
            <BreakdownRows figure={model.next} s={s} tx={tx} />
            <div className={styles.summaryLineRow}>
              <span className={styles.summaryLineLabel}>{tx.grossLabel}</span>
              <span className={styles.summaryNextGross}>
                {model.next.gross}
              </span>
            </div>
          </>
        )}
        <p className={styles.summaryNote}>{s('cancelNote')}</p>
      </section>

      {/* Why a card is asked for although today's charge is zero. */}
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
    </>
  );
}
