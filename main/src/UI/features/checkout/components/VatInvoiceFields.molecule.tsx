// UI/features/checkout/components/VatInvoiceFields.molecule.tsx
// VAT invoice — the „Faktura na firmę" switch + an optional subform (B2B with a NIP). Presentational
// (state/validation live in useVatInvoiceForm). VAT 23% is added to EVERY payment regardless of the
// switch — the subform only attaches company data (name/address/NIP) to the invoice.

import { ToggleAtom } from '../../../components/Toggle/Toggle.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { InputAtom } from '../../../components/Input/Input.atom';
import { SelectAtom } from '../../../components/Select/Select.atom';
import { useTranslations } from 'next-intl';
import type { CountryCode } from '@kernel/domain/localization/country.config';
import type { BillingProfile } from '@kernel/domain/account/billing-profile.contract-schemas';
import { taxIdTypesForCountry } from '../tax-id-types';
import type { VatFormState, VatFieldErrors } from '../hooks/useVatInvoiceForm';
import styles from '../PlanCheckoutPanel.module.css';

export interface VatInvoiceFieldsTranslations {
  vatInvoiceToggle: string;
  vatInvoiceHint: string;
  companyNameLabel: string;
  companyNamePlaceholder: string;
  nipLabel: string;
  nipPlaceholder: string;
  addressLine1Label: string;
  addressLine1Placeholder: string;
  postalCodeLabel: string;
  postalCodePlaceholder: string;
  cityLabel: string;
  cityPlaceholder: string;
}

interface VatInvoiceFieldsProps {
  isOn: boolean;
  onToggle: (checked: boolean) => void;
  form: VatFormState;
  errors: VatFieldErrors;
  onFieldChange: (field: keyof VatFormState, value: string) => void;
  disabled: boolean;
  tx: VatInvoiceFieldsTranslations;
  country: CountryCode;
  sharedAddress?: boolean;
  onOpenTaxPortal?: () => void;
  portalBusy?: boolean;
  savedTaxIds?: BillingProfile['tax_ids'];
  savedCompanyName?: string | null;
  hasSavedCompany?: boolean;
}

export function VatInvoiceFieldsMolecule({
  isOn,
  onToggle,
  form,
  errors,
  onFieldChange,
  disabled,
  tx,
  country,
  sharedAddress = false,
  onOpenTaxPortal,
  portalBusy = false,
  savedTaxIds = [],
  savedCompanyName = null,
  hasSavedCompany = false,
}: VatInvoiceFieldsProps) {
  const c = useTranslations('account.checkout');
  const taxTypes = taxIdTypesForCountry(country);
  return (
    <div className={styles.vatInvoiceSection}>
      <ToggleAtom
        label={
          hasSavedCompany ? c('editSavedBillingDetails') : tx.vatInvoiceToggle
        }
        checked={isOn}
        onChange={e => onToggle(e.target.checked)}
        disabled={disabled}
      />
      {!isOn && hasSavedCompany && (
        <div>
          <p>{c('savedBillingDetails')}</p>
          {savedCompanyName && <p>{savedCompanyName}</p>}
          {savedTaxIds.map(id => (
            <p key={`${id.type}:${id.value}`}>{id.value}</p>
          ))}
        </div>
      )}

      <div className={styles.vatReveal} data-open={isOn || undefined}>
        <div className={styles.vatRevealClip}>
          <div className={styles.vatInvoiceForm}>
            <p className={styles.vatInvoiceHint}>{c('businessInvoiceHint')}</p>
            <InputAtom
              label={tx.companyNameLabel}
              placeholder={tx.companyNamePlaceholder}
              value={form.companyName}
              onChange={e => onFieldChange('companyName', e.target.value)}
              error={errors.companyName}
              disabled={disabled}
              autoComplete='organization'
            />
            {savedTaxIds.length > 0 && (
              <>
                <p>{c('savedTaxIds')}</p>
                {savedTaxIds.map(id => (
                  <p key={`${id.type}:${id.value}`}>{id.value}</p>
                ))}
              </>
            )}
            {savedTaxIds.length === 0 && taxTypes.length > 1 && (
              <SelectAtom
                label={c('taxIdTypeLabel')}
                value={form.taxIdType}
                onValueChange={value => onFieldChange('taxIdType', value)}
                options={taxTypes.map(type => ({
                  value: type,
                  label:
                    type === 'ca_bn'
                      ? c('taxType.caBn')
                      : type === 'ca_gst_hst'
                        ? c('taxType.caGstHst')
                        : type === 'ca_pst_bc'
                          ? c('taxType.caPstBc')
                          : type === 'ca_pst_mb'
                            ? c('taxType.caPstMb')
                            : type === 'ca_pst_sk'
                              ? c('taxType.caPstSk')
                              : type === 'ca_qst'
                                ? c('taxType.caQst')
                                : type.toUpperCase().replaceAll('_', ' '),
                }))}
                error={errors.taxIdType}
                disabled={disabled}
              />
            )}
            {savedTaxIds.length === 0 && taxTypes.length > 0 && (
              <InputAtom
                label={c('taxIdOptional')}
                value={form.nip}
                onChange={e => onFieldChange('nip', e.target.value)}
                error={errors.nip}
                disabled={disabled}
              />
            )}
            {(taxTypes.length === 0 || savedTaxIds.length > 0) && (
              <>
                <p>
                  {savedTaxIds.length > 0
                    ? c('manageSavedTaxIds')
                    : c('taxIdPortalHint')}
                </p>
                <ButtonAtom
                  variant='outlined'
                  onClick={onOpenTaxPortal}
                  disabled={disabled || portalBusy}
                  loading={portalBusy}>
                  {c('openTaxPortal')}
                </ButtonAtom>
              </>
            )}
            {!sharedAddress && (
              <>
                <InputAtom
                  label={tx.addressLine1Label}
                  placeholder={tx.addressLine1Placeholder}
                  value={form.addressLine1}
                  onChange={e => onFieldChange('addressLine1', e.target.value)}
                  error={errors.addressLine1}
                  disabled={disabled}
                  autoComplete='address-line1'
                />
                <div className={styles.vatInvoiceRow}>
                  <InputAtom
                    label={tx.postalCodeLabel}
                    placeholder={tx.postalCodePlaceholder}
                    value={form.addressPostalCode}
                    onChange={e =>
                      onFieldChange('addressPostalCode', e.target.value)
                    }
                    error={errors.addressPostalCode}
                    disabled={disabled}
                    autoComplete='postal-code'
                    className={styles.vatInvoicePostal}
                  />
                  <InputAtom
                    label={tx.cityLabel}
                    placeholder={tx.cityPlaceholder}
                    value={form.addressCity}
                    onChange={e => onFieldChange('addressCity', e.target.value)}
                    error={errors.addressCity}
                    disabled={disabled}
                    autoComplete='address-level2'
                    className={styles.vatInvoiceCity}
                  />
                </div>
                {country !== 'PL' && (
                  <InputAtom
                    label={c('addressStateLabel')}
                    value={form.addressState}
                    onChange={e =>
                      onFieldChange('addressState', e.target.value)
                    }
                    disabled={disabled}
                    autoComplete='address-level1'
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
