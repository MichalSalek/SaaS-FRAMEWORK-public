import { PaymentElement } from '@stripe/react-stripe-js/checkout';
import type { useCheckoutBillingState } from '../hooks/useCheckoutBillingState';
import type { CheckoutFormTranslations } from './CheckoutForm.types';
import { CheckoutBillingAddressMolecule } from './CheckoutBillingAddress.molecule';
import { CheckoutCompanyFieldsMolecule } from './CheckoutCompanyFields.molecule';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { useTranslations } from 'next-intl';
import styles from '../PlanCheckoutPanel.module.css';

export function CheckoutPaymentDetailsOrganism({
  billing,
  disabled,
  appliedCompany,
  onOpenTaxPortal,
  tx,
}: {
  billing: ReturnType<typeof useCheckoutBillingState>;
  disabled: boolean;
  appliedCompany: string | null;
  onOpenTaxPortal: () => void;
  tx: CheckoutFormTranslations;
}) {
  const {
    billingCountry: country,
    setReady: onReady,
    setSharedAddress: onAddressChange,
    billingNameRef,
    needsAddress,
    vat,
    fingerprint: companyFingerprint,
    taxPortal: { busy: portalBusy, failed: portalFailed },
    requiresTaxReview,
    onCountryInput,
  } = billing;
  const externalAddress = needsAddress || vat.isOn;
  const t = useTranslations('account.checkout');
  return (
    <>
      <CheckoutBillingAddressMolecule
        onReady={onReady}
        onAddressChange={onAddressChange}
        onCountryInput={onCountryInput}
        billingNameRef={billingNameRef}
        enabled={needsAddress}
        disabled={disabled || portalBusy}
      />
      {requiresTaxReview && (
        <div role='status'>
          <p>{t('fiscalCountryReview')}</p>
          <ButtonAtom
            variant='outlined'
            onClick={onOpenTaxPortal}
            disabled={portalBusy || disabled}
            loading={portalBusy}>
            {t('openTaxPortal')}
          </ButtonAtom>
          {portalFailed && <p role='alert'>{t('taxPortalError')}</p>}
        </div>
      )}
      {needsAddress && vat.isOn && vat.errors.addressPostalCode && (
        <p role='alert'>{vat.errors.addressPostalCode}</p>
      )}
      <div className={styles.paymentElementHost}>
        <PaymentElement
          key={externalAddress ? 'external-address' : 'stripe-address'}
          {...(externalAddress
            ? {
                options: {
                  fields: { billingDetails: { address: 'never' as const } },
                },
              }
            : {})}
        />
      </div>
      {country && (
        <CheckoutCompanyFieldsMolecule
          country={country}
          vat={vat}
          disabled={disabled}
          appliedCompany={appliedCompany}
          companyFingerprint={companyFingerprint}
          sharedAddress={needsAddress}
          onOpenTaxPortal={onOpenTaxPortal}
          portalBusy={portalBusy}
          portalFailed={portalFailed}
          tx={tx}
        />
      )}
    </>
  );
}
