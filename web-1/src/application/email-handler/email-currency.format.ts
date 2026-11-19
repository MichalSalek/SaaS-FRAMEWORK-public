import type { LocaleType } from '@kernel/domain/i18n/i18n.config';

/** Format Stripe's integer charge units; ISK and UGX use two API decimals. */
export function formatEmailCurrency(
  amountMinor: number,
  currency: string,
  locale: LocaleType
): string | null {
  if (
    !Number.isSafeInteger(amountMinor) ||
    amountMinor < 0 ||
    !/^[a-z]{3}$/i.test(currency)
  ) {
    return null;
  }
  const code = currency.toUpperCase();
  if (!Intl.supportedValuesOf('currency').includes(code)) {
    return null;
  }
  try {
    const base = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'code',
    });
    const digits = base.resolvedOptions().maximumFractionDigits;
    if (digits === undefined) {
      return null;
    }
    const stripeDigits = code === 'ISK' || code === 'UGX' ? 2 : digits;
    const divisor = 10n ** BigInt(stripeDigits);
    const minor = BigInt(amountMinor);
    const whole = minor / divisor;
    const fraction = minor % divisor;
    const fractionDigits =
      stripeDigits > digits && fraction !== 0n ? stripeDigits : digits;
    const formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'code',
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    const fractionText = fraction.toString().padStart(stripeDigits, '0');
    return formatter
      .formatToParts(whole)
      .map(part => (part.type === 'fraction' ? fractionText : part.value))
      .join('');
  } catch {
    return null;
  }
}
