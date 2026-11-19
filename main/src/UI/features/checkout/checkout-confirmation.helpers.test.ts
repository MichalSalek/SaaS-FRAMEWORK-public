import { describe, expect, it } from 'vitest';
import { resolveCheckoutConfirmationUrl } from './checkout-confirmation.helpers';

describe('checkout confirmation navigation', () => {
  it('keeps the canonical backend plan, interval, source and locale after card success', () => {
    expect(
      resolveCheckoutConfirmationUrl(
        'https://example.test/de/app/checkout/return?sessionId={CHECKOUT_SESSION_ID}&plan=STUDIO&period=year&source=account-pay',
        'cs_live_mock'
      )
    ).toBe(
      'https://example.test/de/app/checkout/return?sessionId=cs_live_mock&plan=STUDIO&period=year&source=account-pay'
    );
  });
  it('encodes the session identifier without changing the return path', () => {
    expect(
      resolveCheckoutConfirmationUrl(
        '/app/checkout/return?sessionId={CHECKOUT_SESSION_ID}',
        'cs/1'
      )
    ).toBe('/app/checkout/return?sessionId=cs%2F1');
  });
});
