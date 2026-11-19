import { useTranslations } from 'next-intl';
import type { CountryCode } from '@kernel/domain/localization/country.config';
import type { UseVatInvoiceForm } from '../hooks/useVatInvoiceForm';
import {
  VatInvoiceFieldsMolecule,
  type VatInvoiceFieldsTranslations,
} from './VatInvoiceFields.molecule';

export function CheckoutCompanyFieldsMolecule({
  country,
  vat,
  disabled,
  appliedCompany,
  tx,
  sharedAddress,
  onOpenTaxPortal,
  portalBusy,
  portalFailed,
  companyFingerprint,
}: {
  country: CountryCode;
  vat: UseVatInvoiceForm;
  disabled: boolean;
  appliedCompany: string | null;
  tx: VatInvoiceFieldsTranslations;
  sharedAddress: boolean;
  onOpenTaxPortal: () => void;
  portalBusy: boolean;
  portalFailed: boolean;
  companyFingerprint: string;
}) {
  const t = useTranslations('account.checkout');
  return (
    <>
      <VatInvoiceFieldsMolecule
        country={country}
        isOn={vat.isOn}
        onToggle={vat.setIsOn}
        form={vat.form}
        errors={vat.errors}
        onFieldChange={vat.setField}
        disabled={disabled}
        tx={tx}
        sharedAddress={sharedAddress}
        onOpenTaxPortal={onOpenTaxPortal}
        portalBusy={portalBusy}
        savedTaxIds={vat.savedTaxIds}
        savedCompanyName={vat.savedCompanyName}
        hasSavedCompany={vat.hasSavedCompany}
      />
      {portalFailed && <p role='alert'>{t('taxPortalError')}</p>}
      {vat.isOn && appliedCompany === companyFingerprint && (
        <p role='status'>{t('billingUpdatedReview')}</p>
      )}
    </>
  );
}
