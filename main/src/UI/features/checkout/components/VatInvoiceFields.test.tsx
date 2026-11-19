import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
import { VatInvoiceFieldsMolecule } from './VatInvoiceFields.molecule';

describe('tax ID before checkout', () => {
  it('shows the newly saved company and ID after preview instead of suggesting a personal invoice', () => {
    const tx = {
      vatInvoiceToggle: 'company',
      vatInvoiceHint: '',
      companyNameLabel: 'name',
      companyNamePlaceholder: '',
      nipLabel: '',
      nipPlaceholder: '',
      addressLine1Label: 'address',
      addressLine1Placeholder: '',
      postalCodeLabel: 'postal',
      postalCodePlaceholder: '',
      cityLabel: 'city',
      cityPlaceholder: '',
    };
    const form = {
      companyName: 'Salon Ltd',
      addressLine1: '',
      addressLine2: '',
      addressCity: '',
      addressPostalCode: '',
      addressState: '',
      nip: 'US123',
      taxIdType: 'us_ein',
    };
    const open = vi.fn();
    const ids = [
      { type: 'us_ein', value: 'US123', verification_status: 'pending' },
    ];
    const props = {
      country: 'US' as const,
      onToggle: () => {},
      form,
      errors: {},
      onFieldChange: () => {},
      disabled: false,
      tx,
      sharedAddress: true,
      onOpenTaxPortal: open,
      savedTaxIds: ids,
      savedCompanyName: 'Salon Ltd',
      hasSavedCompany: true,
    };
    const view = render(
      <VatInvoiceFieldsMolecule
        {...props}
        isOn
        savedTaxIds={[]}
        savedCompanyName={null}
        hasSavedCompany={false}
      />
    );
    expect(view.getByLabelText('taxIdOptional')).toBeDefined();
    // The company preview persisted the ID and refetched the profile.
    view.rerender(<VatInvoiceFieldsMolecule {...props} isOn />);
    expect(view.queryByLabelText('taxIdOptional')).toBeNull();
    view.rerender(<VatInvoiceFieldsMolecule {...props} isOn={false} />);
    expect(view.getByText('savedBillingDetails')).toBeDefined();
    expect(view.getByText('Salon Ltd')).toBeDefined();
    expect(view.queryByLabelText('taxIdOptional')).toBeNull();
    view.rerender(<VatInvoiceFieldsMolecule {...props} isOn />);
    expect(view.getByText('US123')).toBeDefined();
    expect(view.queryByLabelText('taxIdOptional')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'openTaxPortal' }));
    expect(open).toHaveBeenCalledOnce();
  });
  it('keeps a saved Canadian tax ID type and gives each type a readable label', () => {
    const tx = {
      vatInvoiceToggle: 'company',
      vatInvoiceHint: '',
      companyNameLabel: 'name',
      companyNamePlaceholder: '',
      nipLabel: '',
      nipPlaceholder: '',
      addressLine1Label: 'address',
      addressLine1Placeholder: '',
      postalCodeLabel: 'postal',
      postalCodePlaceholder: '',
      cityLabel: 'city',
      cityPlaceholder: '',
    };
    const view = render(
      <VatInvoiceFieldsMolecule
        country='CA'
        isOn
        onToggle={() => {}}
        form={{
          companyName: '',
          addressLine1: '',
          addressLine2: '',
          addressCity: '',
          addressPostalCode: '',
          addressState: '',
          nip: '123',
          taxIdType: 'ca_qst',
        }}
        errors={{}}
        onFieldChange={() => {}}
        disabled={false}
        tx={tx}
        sharedAddress
      />
    );
    expect((view.getByRole('combobox') as HTMLSelectElement).value).toBe(
      'ca_qst'
    );
    expect(view.getByRole('option', { name: 'taxType.caQst' })).toBeDefined();
    expect(
      view.getByRole('option', { name: 'taxType.caGstHst' })
    ).toBeDefined();
  });
  it('offers the existing portal for unsupported countries before payment', () => {
    const open = vi.fn();
    const view = render(
      <VatInvoiceFieldsMolecule
        country='CH'
        isOn
        onToggle={() => {}}
        form={{
          companyName: '',
          addressLine1: '',
          addressLine2: '',
          addressCity: '',
          addressPostalCode: '',
          addressState: '',
          nip: '',
          taxIdType: '',
        }}
        errors={{}}
        onFieldChange={() => {}}
        disabled={false}
        tx={{
          vatInvoiceToggle: 'company',
          vatInvoiceHint: '',
          companyNameLabel: 'company name',
          companyNamePlaceholder: '',
          nipLabel: '',
          nipPlaceholder: '',
          addressLine1Label: 'address',
          addressLine1Placeholder: '',
          postalCodeLabel: 'postal',
          postalCodePlaceholder: '',
          cityLabel: 'city',
          cityPlaceholder: '',
        }}
        sharedAddress
        onOpenTaxPortal={open}
      />
    );
    fireEvent.click(view.getByRole('button', { name: 'openTaxPortal' }));
    expect(open).toHaveBeenCalledOnce();
    expect(view.queryByLabelText('address')).toBeNull();
    expect(view.queryByLabelText('postal')).toBeNull();
  });
});
