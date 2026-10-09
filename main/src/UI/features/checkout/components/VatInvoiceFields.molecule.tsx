// UI/features/checkout/components/VatInvoiceFields.molecule.tsx
// Faktura VAT — switch „Faktura na firmę" + opcjonalny subform (B2B z NIP).
// Prezentacyjny (stan/walidacja żyją w useVatInvoiceForm). VAT 23% jest doliczony
// do KAŻDEJ płatności niezależnie od tego switcha — subform tylko dopina dane
// firmowe (nazwa/adres/NIP) do faktury.

import { ToggleAtom } from '../../../components/Toggle/Toggle.atom';
import { InputAtom } from '../../../components/Input/Input.atom';
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
}

export function VatInvoiceFieldsMolecule({
  isOn,
  onToggle,
  form,
  errors,
  onFieldChange,
  disabled,
  tx,
}: VatInvoiceFieldsProps) {
  return (
    <div className={styles.vatInvoiceSection}>
      <ToggleAtom
        label={tx.vatInvoiceToggle}
        checked={isOn}
        onChange={e => onToggle(e.target.checked)}
        disabled={disabled}
      />

      <div className={styles.vatReveal} data-open={isOn || undefined}>
        <div className={styles.vatRevealClip}>
          <div className={styles.vatInvoiceForm}>
            <p className={styles.vatInvoiceHint}>{tx.vatInvoiceHint}</p>
            <InputAtom
              label={tx.companyNameLabel}
              placeholder={tx.companyNamePlaceholder}
              value={form.companyName}
              onChange={e => onFieldChange('companyName', e.target.value)}
              error={errors.companyName}
              disabled={disabled}
              autoComplete='organization'
            />
            <InputAtom
              label={tx.nipLabel}
              placeholder={tx.nipPlaceholder}
              value={form.nip}
              onChange={e => onFieldChange('nip', e.target.value)}
              error={errors.nip}
              disabled={disabled}
              inputMode='numeric'
            />
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
          </div>
        </div>
      </div>
    </div>
  );
}
