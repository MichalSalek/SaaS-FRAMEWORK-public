/** Only Stripe's hosted invoice page may receive the billing recovery action. */
export function isStripeHostedInvoiceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'invoice.stripe.com' &&
      url.port === '' &&
      url.username === '' &&
      url.password === '' &&
      url.pathname.startsWith('/i/')
    );
  } catch {
    return false;
  }
}
