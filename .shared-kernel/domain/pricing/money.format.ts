/** PLN, USD and EUR use two Stripe API minor-unit digits. */
const MINOR_UNIT_DIVISOR = 100;

function requireMinorAmount(amount: number): void {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError('Money must be an integer in minor units');
  }
}

export function formatMinorAmount(amountMinor: number, locale: string): string {
  requireMinorAmount(amountMinor);
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
    minimumFractionDigits: amountMinor % MINOR_UNIT_DIVISOR === 0 ? 0 : 2,
  }).format(amountMinor / MINOR_UNIT_DIVISOR);
}

/** Currency codes keep USD explicit even for visitors from Canada. */
export function formatMoney(
  amountMinor: number,
  currency: string,
  locale: string
): string {
  requireMinorAmount(amountMinor);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.toUpperCase(),
    currencyDisplay: 'code',
    maximumFractionDigits: 2,
    minimumFractionDigits: amountMinor % MINOR_UNIT_DIVISOR === 0 ? 0 : 2,
  }).format(amountMinor / MINOR_UNIT_DIVISOR);
}
