// UI/features/auth/components/OnboardingPlanChooser.organism.tsx
//
// SPE-W4 — the owner-voted plan chooser (Variant B, wired 1:1 from the throwaway
// /dev/onboarding-pricing playground) for the onboarding CHECKOUT step.
//
// FREE / PRO / PRO+ / STUDIO render as tap-to-select cards (SCALE = a contact
// row), the recommended tier (isPopular) carries a badge, monthly/yearly is a
// BillingToggle, and features come from the REAL usePricingPlans hook — parity
// with the account page + the unified feature bullets (account-card ADR: reuse
// the DATA hook, do NOT build a shared PlanCardShell).
//
// FULLY CONTROLLED: selection + billing live in the onboarding form (watched
// `selected_plan_id` / `billing_period`), threaded down as props with change
// callbacks, so a tap updates the form immediately and Back/Continue preserves
// the choice. FREE renders as the honest free-forever plan (no card); its ceiling
// comes from usage-scaling + watermark, not from "Demo" naming (FP2, 2026-07-13).

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { CheckIcon, RocketLaunchIcon } from '@phosphor-icons/react';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import {
  usePricingPlans,
  type PricingPlanCard,
} from '../../shared/pricing/hooks/usePricingPlans';
import { groszToPln } from '../../shared/pricing/pricingFormat';
import { useCurrentLang } from '../../../hooks/useCurrentLang';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';
import {
  BillingToggleMolecule,
  type BillingCycle,
} from '../../../components/BillingToggle/BillingToggle.molecule';
import { ONBOARDING_ACTION_SLOT_ID } from './OnboardingActionBar.molecule';
import styles from './OnboardingPlanChooser.module.css';

interface OnboardingPlanChooserProps {
  /** Watched form field — the currently selected plan. `null` only when a
   *  SCALE/invalid deep-link fell through the funnel with no plan; otherwise
   *  the pricing funnel's plan, or the PRO default when the chooser is the
   *  fallback after a failed Free activation (DECISION at ONBOARDING_DEFAULTS). */
  selectedPlanId: PricingPlan | null;
  /** Watched form field — the current billing cycle for the chosen plan. */
  billingPeriod: BillingPeriod;
  /** Tap a card → drive the form's `selected_plan_id`. */
  onSelectPlan: (planId: PricingPlan) => void;
  /** Toggle billing → drive the form's `billing_period`. */
  onSelectBilling: (period: BillingPeriod) => void;
  /** Primary CTA — go to payment (paid) or start on Free. */
  onProceed: () => void;
}

/** Tier sequence for the selectable cards; SCALE is handled as a contact row. */
const CARD_ORDER: readonly PricingPlan[] = [
  PricingPlanValue.FREE,
  PricingPlanValue.PRO,
  PricingPlanValue.PRO_PLUS,
  PricingPlanValue.STUDIO,
];

function toBillingPeriod(cycle: BillingCycle): BillingPeriod {
  return cycle === 'yearly' ? 'year' : 'month';
}

export function OnboardingPlanChooserOrganism({
  selectedPlanId,
  billingPeriod,
  onSelectPlan,
  onSelectBilling,
  onProceed,
}: OnboardingPlanChooserProps) {
  const t = useTranslations('pages.onboarding');
  const tButtons = useTranslations('buttons');
  const {
    data: plans,
    isPending,
    isFetching,
    refetch,
    pricesUnavailable,
  } = usePricingPlans();

  // Finding #4: SCALE row CTA opens contact, mirroring AccountPay's
  // handleContactSales (mailto BRAND_CONFIG.email.contact). location.assign()
  // (method call, not `location.href =`) so the React Compiler does not flag an
  // external-variable write. A click handler only runs in the browser.
  const handleContactSales = () => {
    window.location.assign(`mailto:${BRAND_CONFIG.email.contact}`);
  };

  // A retry from the error view keeps the query in `error` status while it
  // fetches, so `isPending` alone would leave the retry without feedback.
  if (isPending || (plans == null && isFetching)) {
    return (
      <p className={styles.notice} role='status'>
        {t('plansLoading')}
      </p>
    );
  }
  // Error view ONLY when there is nothing to show. The query re-polls every
  // 30 s while it is in error or on fallback prices, so `isError` alone also
  // fires on a failed BACKGROUND refetch with the plans still cached: that
  // swapped a working chooser (and its CTA in the action bar) for a dead
  // message. With no plans at all the step had no way forward, so the error
  // carries a manual retry.
  if (plans == null) {
    return (
      <ErrorStateMolecule
        message={t('plansLoadError')}
        retryLabel={tButtons('retry')}
        onRetry={() => void refetch()}
        isRetrying={isFetching}
      />
    );
  }

  const cards = CARD_ORDER.map(id => plans.find(p => p.id === id)).filter(
    (p): p is PricingPlanCard => p != null
  );
  const scalePlan = plans.find(p => p.id === PricingPlanValue.SCALE);
  const cycle: BillingCycle = billingPeriod === 'year' ? 'yearly' : 'monthly';
  const isFreeSelected = selectedPlanId === PricingPlanValue.FREE;
  // Finding #3: Stripe prices are in fallback (is_fallback) → paid plans have
  // null prices (rendered as U+2212) and a paid checkout would hit a
  // resolve-price error. Lock paid card selection + the paid CTA and steer to
  // the Demo (FREE needs no Stripe price). Mirrors AccountPay's pricesUnavailable
  // gate (disableActions + a status notice).
  const paidLocked = pricesUnavailable && !isFreeSelected;

  // Dla każdej karty: zbiór cech WSZYSTKICH tańszych progów (patrz DECISION
  // nad `collapsedFirst`). Liczone raz, w kolejności `CARD_ORDER`.
  const cheaperFeatures: Partial<Record<PricingPlan, ReadonlySet<string>>> = {};
  const seenSoFar = new Set<string>();
  for (const card of cards) {
    cheaperFeatures[card.id] = new Set(seenSoFar);
    card.features.forEach(f => seenSoFar.add(f));
  }

  return (
    <>
      <BillingToggleMolecule
        variant='account'
        className={styles.toggleRow}
        cycle={cycle}
        onChange={next => onSelectBilling(toBillingPeriod(next))}
        monthlyLabel={t('planBillingMonthly')}
        yearlyLabel={t('planBillingYearly')}
        hintLabel={t('planBillingHint')}
      />

      {pricesUnavailable && (
        <p className={styles.pricesNotice} role='status'>
          {t('planChooserPricesUnavailable')}
        </p>
      )}

      <div className={styles.cardStack}>
        {cards.map(plan => {
          const isSel = plan.id === selectedPlanId;
          const isFree = plan.id === PricingPlanValue.FREE;
          const isRec = plan.isPopular === true;
          // Paid plans are unselectable while Stripe prices are unavailable
          // (finding #3) — only FREE/Demo can proceed without a resolved price.
          const cardLocked = pricesUnavailable && !isFree;
          // Nota o trialu należy się planowi PŁATNEMU z rozstrzygniętą ceną:
          // Free trialu nie ma, SCALE ma wycenę indywidualną, a przy cenach z
          // fallbacku Stripe karta pokazuje U+2212 i jest zablokowana, więc
          // obietnica „pierwsze 30 dni za darmo" wisiałaby nad niczym.
          const priceForCycle =
            cycle === 'yearly' ? plan.priceYearly : plan.priceMonthly;
          const showsTrial =
            !isFree && plan.isCustom !== true && priceForCycle !== null;
          const Icon = plan.icon;
          return (
            <button
              key={plan.id}
              type='button'
              aria-pressed={isSel}
              disabled={cardLocked}
              onClick={() => onSelectPlan(plan.id)}
              className={clsx(styles.card, styles.cardButton, {
                [styles.cardSelected ?? '']: isSel,
                [styles.cardRecommended ?? '']: isRec && !isSel,
              })}>
              <div className={styles.cardTop}>
                <div className={styles.cardNameRow}>
                  <span className={styles.iconHalo} aria-hidden='true'>
                    <Icon size={18} weight='duotone' />
                  </span>
                  <span className={styles.planName}>
                    {isFree ? t('planDemoName') : plan.name}
                    {isFree && (
                      <span className={styles.demoTag}>
                        {t('planDemoSublabel')}
                      </span>
                    )}
                  </span>
                </div>
                {isRec ? (
                  <span className={styles.badge}>{t('planPopularBadge')}</span>
                ) : (
                  <span
                    className={clsx(styles.radioDot, {
                      [styles.radioDotOn ?? '']: isSel,
                    })}
                    aria-hidden='true'>
                    {isSel && <CheckIcon size={12} weight='bold' />}
                  </span>
                )}
              </div>
              <div className={styles.priceRow}>
                <PriceBlock plan={plan} cycle={cycle} t={t} />
              </div>
              {/* S123: karta płatnego planu pokazywała SAMĄ kwotę, więc na
                  kroku, na którym zapada decyzja, trial był niewidoczny (żył
                  tylko w podtytule nad zwojem). Reguła ownera S42 mówi wprost,
                  że przy planie z okresem próbnym bohaterem karty jest OFERTA
                  WEJŚCIA, a kwota schodzi na mały druk; `/pricing` robi to
                  pełną inwersją przez `PlanTrialFramingMolecule`. Tutaj kwota
                  została na miejscu (kompozycja karty to zagłosowany wariant B),
                  ale trial przestał być niewidoczny. Pełna inwersja hierarchii
                  = decyzja ownera, nie cicha zmiana głosowanej karty. */}
              {showsTrial ? (
                <p className={styles.trialNote}>{t('planTrialNote')}</p>
              ) : null}
              <FeatureList
                features={collapsedFirst(
                  plan.features,
                  cheaperFeatures[plan.id]
                )}
                max={isSel ? 6 : 3}
              />
            </button>
          );
        })}

        {scalePlan != null && (
          <div className={styles.contactRow}>
            <span className={styles.contactText}>
              <RocketLaunchIcon size={15} weight='duotone' aria-hidden='true' />
              <span>
                <strong>{scalePlan.name}</strong> {t('planScaleRow')}
              </span>
            </span>
            <ButtonAtom
              variant='outlined'
              size='sm'
              onClick={handleContactSales}>
              {t('planScaleContact')}
            </ButtonAtom>
          </div>
        )}
      </div>

      <div className={styles.ctaStack}>
        <ActionSlotPortal>
          <ButtonAtom
            variant='primary'
            size='lg'
            className={clsx(styles.fullBtn, 'haptic-press')}
            onClick={onProceed}
            disabled={paidLocked || selectedPlanId === null}>
            {selectedPlanId === null
              ? t('planChooserCtaSelect')
              : isFreeSelected
                ? t('planChooserCtaFree')
                : t('planChooserCtaPaid')}
          </ButtonAtom>
        </ActionSlotPortal>
        {/* Karta JEST wymagana przy płatnym planie, a ekran o niej milczał:
            pierwszą rzeczą po kliknięciu „Zacznij 30 dni za darmo" był formularz
            karty. To nie jest podważanie ścieżki z kartą (decyzja zamknięta,
            §18), tylko ujawnienie jej dokładnie tam, gdzie następuje. Ten sam
            wzorzec co kanon obsługi obiekcji w BRAND_BIBLE („Masz 30 dni triala.
            Anulujesz jednym kliknięciem."). */}
        {selectedPlanId !== null && !isFreeSelected && (
          <p className={styles.ctaNote}>{t('planTrialCardNote')}</p>
        )}
      </div>
    </>
  );
}

/** Renders the CTA into the sticky action bar's slot (DECISION at
 *  ONBOARDING_ACTION_SLOT_ID); inline when the slot is absent. */
function ActionSlotPortal({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null | undefined>(undefined);
  useEffect(() => {
    setSlot(document.getElementById(ONBOARDING_ACTION_SLOT_ID));
  }, []);
  if (slot === undefined) {
    return null;
  }
  return slot ? createPortal(children, slot) : <>{children}</>;
}

/* ── Price block. FREE => "0 zł"; null (Stripe fallback) => U+2212, never free. ── */
// Symbol waluty z Intl (pl → „zł", en/de → „PLN"), nie literał: ceny są zawsze w
// PLN, ale zapis symbolu jest per język — literał „zł" omijał i18n w EN/DE.
function plnCurrencySymbol(lang: string): string {
  return (
    new Intl.NumberFormat(lang, { style: 'currency', currency: 'PLN' })
      .formatToParts(0)
      .find(part => part.type === 'currency')?.value ?? 'zł'
  );
}

function PriceBlock({
  plan,
  cycle,
  t,
}: {
  plan: PricingPlanCard;
  cycle: BillingCycle;
  t: ReturnType<typeof useTranslations>;
}) {
  const lang = useCurrentLang();
  if (plan.isCustom === true) {
    return <span className={styles.priceCurrency}>{t('planPriceCustom')}</span>;
  }
  const price = cycle === 'monthly' ? plan.priceMonthly : plan.priceYearly;
  if (price === null) {
    // Parity with the real card: null price (Stripe unavailable) => U+2212,
    // never "0 zł" (null is not free).
    return <span className={styles.priceAmount}>{'−'}</span>;
  }
  const currency = plnCurrencySymbol(lang);
  if (price === 0) {
    return (
      <>
        <span className={styles.priceAmount}>0</span>
        <span className={styles.priceCurrency}>{currency}</span>
      </>
    );
  }
  return (
    <>
      <span className={styles.priceAmount}>{groszToPln(price)}</span>
      <span className={styles.priceCurrency}>{currency}</span>
      <span className={styles.priceCycle}>
        {cycle === 'yearly'
          ? t('planPricePerMonthYearly')
          : t('planPricePerMonth')}
      </span>
    </>
  );
}

/* DECISION (nie usuwaj tego komentarza):
 * Karta zwinięta pokazuje trzy cechy, a tablice cech są budowane od części
 * WSPÓLNEJ: Pro, Pro Marka i Studio zaczynały się tą samą trójką (galeria bez
 * limitu, klientki bez limitu, bez znaku wodnego). Efekt na ekranie wyboru:
 * plan za 179 zł wyglądał uboższo niż ten za 79 zł, bo różnicujące pozycje
 * (zespół salonu, pełna historia, pule pinów) były ucinane. To wprost łamie
 * regułę ownera z S49, że wabik nie może anty-sprzedawać.
 *
 * Dlatego na początek wędrują cechy, których NIE MA żaden tańszy próg, a resztę
 * dokładamy w oryginalnej kolejności, żeby karta zawsze miała komplet. To NIE
 * jest odsyłacz „wszystko z planu Pro" — ten owner zakazał wprost (S81, temat
 * zamknięty); pełna lista zostaje, zmienia się wyłącznie KOLEJNOŚĆ.
 *
 * Porównanie idzie po gotowym tekście, nie po kluczu i18n, bo tablica niesie
 * już przetłumaczone stringi. Bliźniak semantyczny o dwóch różnych tekstach
 * („Nieograniczona galeria" w Pro vs „Nieograniczone zdjęcia" w Studio) przejdzie
 * więc jako różnica. To świadomie akceptowane: pozycja i tak należy do planu,
 * a cena za pewność byłaby przepisaniem kontraktu hooka cen.
 */
function collapsedFirst(
  features: readonly string[],
  cheaper: ReadonlySet<string> | undefined
): readonly string[] {
  if (cheaper === undefined || cheaper.size === 0) {
    return features;
  }
  const own = features.filter(f => !cheaper.has(f));
  const shared = features.filter(f => cheaper.has(f));
  return [...own, ...shared];
}

function FeatureList({
  features,
  max,
}: {
  features: readonly string[];
  max: number;
}) {
  const shown = features.slice(0, max);
  return (
    <ul className={styles.featureList}>
      {shown.map(feature => (
        <li key={feature} className={styles.featureItem}>
          <span className={styles.featureCheck} aria-hidden='true'>
            <CheckIcon size={11} weight='bold' />
          </span>
          <span>{feature}</span>
        </li>
      ))}
    </ul>
  );
}
