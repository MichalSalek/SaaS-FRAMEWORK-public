import { useTranslations } from 'next-intl';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { usePricingPlans, type PricingPlanCard } from './hooks/usePricingPlans';
import styles from './EntryPriceNote.module.css';

interface EntryPriceNoteProps {
  className?: string;
  /** Dopisek o taniej opcji rocznej. Tylko tam, gdzie jest miejsce na dwie liczby. */
  withYearly?: boolean;
}

/**
 * Cena wejściowa pod parą CTA, napisana wprost.
 *
 * Powód: próg wejścia jest argumentem ZA, a nie przypisem. Odwiedzający i tak
 * sprawdzi cenę przed decyzją — jeśli musi jej szukać w cenniku, część z nich
 * po prostu nie wróci. Ta sama zasada stoi za CTA „plans from …" na stronach
 * produktowych klienta: przycisk do cennika plus kwota podana obok, czytelnym
 * krojem, nie drobnym drukiem.
 *
 * Kwota pochodzi z ŻYWEGO cennika (Stripe → /pricing/get-plans → usePricingPlans),
 * nigdy z literału w kodzie. Zmiana ceny w Stripe przenosi się tu sama i nie ma
 * sposobu, by strona marketingowa rozjechała się z tym, co naliczy checkout.
 *
 * Gdy ceny są niedostępne (fallback Stripe, błąd transportu, ładowanie) — nie
 * renderuje NICZEGO. Zdanie o cenie, które zgaduje kwotę, jest gorsze niż jego brak;
 * ta sama zasada co przy PriceSlot (nigdy tekst zastępczy zamiast liczby).
 */
/**
 * Najtańszy PŁATNY plan miesięczny i jego odpowiednik przy rozliczeniu rocznym,
 * w pełnych złotych. Czysta funkcja, bo to tutaj mieszkają wszystkie pułapki:
 * ceny przychodzą w groszach, FREE ma 0 (nie „najtaniej", tylko osobna
 * kategoria), a SCALE ma `null`, bo jest kontaktowy.
 */
export function selectEntryPrice(
  plans: readonly PricingPlanCard[]
): { monthly: string; yearly: string | null } | null {
  const selfServe = plans.filter(
    plan => plan.id !== PricingPlanValue.FREE && !plan.isCustom
  );

  const monthly = selfServe
    .map(plan => plan.priceMonthly)
    .filter((price): price is number => price !== null && price > 0);

  if (monthly.length === 0) {
    return null;
  }

  const yearly = selfServe
    .map(plan => plan.priceYearly)
    .filter((price): price is number => price !== null && price > 0);

  return {
    monthly: Math.round(Math.min(...monthly) / 100).toString(),
    yearly:
      yearly.length > 0
        ? Math.round(Math.min(...yearly) / 100).toString()
        : null,
  };
}

export function EntryPriceNoteMolecule({
  className,
  withYearly = false,
}: EntryPriceNoteProps) {
  const t = useTranslations('account.plan');
  const { data, isPending, isError, pricesUnavailable } = usePricingPlans();

  if (isPending || isError || pricesUnavailable || !data) {
    return null;
  }

  const entry = selectEntryPrice(data);
  if (entry === null) {
    return null;
  }

  const yearly = withYearly ? entry.yearly : null;

  return (
    <span className={`${styles.note} ${className ?? ''}`}>
      {t('entryPriceNote', { price: entry.monthly })}
      {yearly !== null && (
        <span className={styles.yearly}>
          {' '}
          {t('entryPriceYearly', { price: yearly })}
        </span>
      )}
    </span>
  );
}
