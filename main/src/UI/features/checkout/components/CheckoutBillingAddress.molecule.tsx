import { useCallback, useRef, useState } from 'react';
import {
  BillingAddressElement,
  useCheckout,
} from '@stripe/react-stripe-js/checkout';
import { useTranslations } from 'next-intl';
import type {
  StripeAddressElementChangeEvent,
  StripeCheckoutContact,
} from '@stripe/stripe-js';
import type { CountryCode } from '@kernel/domain/localization/country.config';
import type { RefObject } from 'react';

/** Sync complete addresses sequentially: a late response cannot replace a newer quote. */
export function CheckoutBillingAddressMolecule({
  onReady,
  onAddressChange,
  onCountryInput,
  billingNameRef,
  enabled = true,
  disabled = false,
}: {
  country?: CountryCode;
  onReady: (ready: boolean) => void;
  onAddressChange?: (contact: StripeCheckoutContact | null) => void;
  onCountryInput?: (country: string | null) => boolean;
  billingNameRef?: RefObject<string | null>;
  enabled?: boolean;
  disabled?: boolean;
}) {
  const state = useCheckout();
  const t = useTranslations('account.checkout');
  const queue = useRef(Promise.resolve());
  const generation = useRef(0);
  const [updateFailed, setUpdateFailed] = useState(false);
  const handleChange = useCallback(
    (event: StripeAddressElementChangeEvent) => {
      const version = ++generation.current;
      onReady(false);
      onAddressChange?.(null);
      setUpdateFailed(false);
      const mayUpdate =
        onCountryInput?.(event.complete ? event.value.address.country : null) ??
        true;
      if (!event.complete || !mayUpdate || state.type !== 'success') {
        return;
      }
      const { checkout } = state;
      const contact = {
        name: billingNameRef?.current ?? event.value.name,
        address: event.value.address,
      };
      queue.current = queue.current
        .catch(() => {})
        .then(async () => {
          if (version !== generation.current) {
            return;
          }
          const result = await checkout.updateBillingAddress(contact);
          if (version === generation.current) {
            if (result.type === 'success') {
              onAddressChange?.(contact);
              onReady(true);
            } else {
              setUpdateFailed(true);
            }
          }
        })
        .catch(() => {
          if (version === generation.current) {
            setUpdateFailed(true);
          }
        });
    },
    [onReady, onAddressChange, onCountryInput, billingNameRef, state]
  );
  if (!enabled) {
    return null;
  }
  return (
    <div inert={disabled || undefined}>
      <BillingAddressElement onChange={handleChange} />
      {updateFailed && <p role='alert'>{t('billingAddressUpdateError')}</p>}
    </div>
  );
}
