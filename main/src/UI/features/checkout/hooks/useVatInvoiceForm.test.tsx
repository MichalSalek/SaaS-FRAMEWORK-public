import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
const saved = vi.hoisted(() =>
  vi.fn(async (_request: Record<string, unknown>) => ({ ok: true }))
);
vi.mock('./useSaveVatInvoiceDetails', () => ({
  useSaveVatInvoiceDetails: () => ({ mutateAsync: saved }),
}));
import { useVatInvoiceForm } from './useVatInvoiceForm';
const messages = {
  required: 'required',
  postalInvalid: 'postal',
  nipInvalid: 'tax',
};

describe('country aware company form', () => {
  it('validates and saves the actual Stripe address country instead of the detected hint', async () => {
    const { result } = renderHook(() => useVatInvoiceForm('PL'));
    act(() => result.current.setField('companyName', 'US Company'));
    const address = {
      address: {
        country: 'US',
        line1: '1 Main St',
        line2: 'Apt 12',
        city: 'Boston',
        postal_code: '02108',
        state: 'MA',
      },
    };
    let valid = false;
    act(() => {
      valid = result.current.validate(messages, address);
    });
    expect(valid).toBe(true);
    await act(async () => result.current.save(address));
    expect(saved).toHaveBeenLastCalledWith(
      expect.objectContaining({
        country: 'US',
        addressLine2: 'Apt 12',
        addressPostalCode: '02108',
      })
    );
  });
  it('offers the actual country tax ID type after the Stripe address changes', async () => {
    const { result, rerender } = renderHook(
      ({ country }: { country: 'PL' | 'US' }) => useVatInvoiceForm(country),
      { initialProps: { country: 'PL' } }
    );
    rerender({ country: 'US' });
    act(() => {
      result.current.setField('companyName', 'US Company');
      result.current.setField('nip', '12-3456789');
    });
    const address = {
      address: {
        country: 'US',
        line1: '1 Main St',
        city: 'Boston',
        postal_code: '02108',
      },
    };
    expect(result.current.form.taxIdType).toBe('us_ein');
    expect(result.current.validate(messages, address)).toBe(true);
    await act(async () => result.current.save(address));
    expect(saved).toHaveBeenLastCalledWith(
      expect.objectContaining({
        country: 'US',
        taxId: { type: 'us_ein', value: '12-3456789' },
      })
    );
  });
  it('accepts US postal codes and a business without a tax ID', () => {
    const { result } = renderHook(() => useVatInvoiceForm('US'));
    act(() => {
      result.current.setField('companyName', 'Company');
      result.current.setField('addressLine1', 'Main Street');
      result.current.setField('addressCity', 'Boston');
      result.current.setField('addressPostalCode', '02108');
    });
    let valid = false;
    act(() => {
      valid = result.current.validate(messages);
    });
    expect(valid).toBe(true);
  });
  it('retains the saved company profile when a detected hint differs', () => {
    const profile = {
      has_customer: true,
      company_name: 'PL company',
      country: 'PL' as const,
      address_line1: 'Warszawska 1',
      address_city: 'Warszawa',
      address_postal_code: '00-001',
      address_state: null,
      tax_ids: [],
      has_company_details: true,
    };
    const { result } = renderHook(() => useVatInvoiceForm('US', profile));
    expect(result.current.form.addressLine1).toBe('Warszawska 1');
    expect(result.current.isOn).toBe(true);
  });
  it('saves the Stripe-collected address without requiring a duplicate company address', async () => {
    const { result } = renderHook(() => useVatInvoiceForm('US'));
    act(() => result.current.setField('companyName', 'Company'));
    const address = {
      name: 'Buyer',
      address: {
        country: 'US',
        line1: '1 Main St',
        line2: 'Apt 12',
        city: 'Boston',
        postal_code: '02108',
        state: 'MA',
      },
    };
    let valid = false;
    act(() => {
      valid = result.current.validate(messages, address);
    });
    expect(valid).toBe(true);
    await act(async () => {
      await result.current.save(address);
    });
    expect(saved).toHaveBeenLastCalledWith(
      expect.objectContaining({
        country: 'US',
        addressLine1: '1 Main St',
        addressLine2: 'Apt 12',
        addressCity: 'Boston',
        addressPostalCode: '02108',
        addressState: 'MA',
      })
    );
  });
  it('keeps strict Polish postal validation in the legacy manual form', () => {
    const { result } = renderHook(() => useVatInvoiceForm('PL'));
    act(() => {
      result.current.setField('companyName', 'Company');
      result.current.setField('addressLine1', 'Street');
      result.current.setField('addressCity', 'Kraków');
      result.current.setField('addressPostalCode', '12345');
    });
    let valid = true;
    act(() => {
      valid = result.current.validate(messages);
    });
    expect(valid).toBe(false);
    expect(result.current.errors.addressPostalCode).toBe('postal');
  });
  it('checks the Polish postal code in the Stripe-collected company address', () => {
    const { result } = renderHook(() => useVatInvoiceForm('PL'));
    act(() => result.current.setField('companyName', 'Company'));
    let valid = true;
    act(() => {
      valid = result.current.validate(messages, {
        address: {
          country: 'PL',
          line1: 'Street',
          city: 'Kraków',
          postal_code: '12345',
        },
      });
    });
    expect(valid).toBe(false);
    expect(result.current.errors.addressPostalCode).toBe('postal');
  });
  it('clears a previously saved apartment only when Stripe address explicitly omits it', async () => {
    const profile = {
      has_customer: true,
      company_name: 'Company',
      country: 'US' as const,
      address_line1: '1 Main St',
      address_line2: 'Apt 12',
      address_city: 'Boston',
      address_postal_code: '02108',
      address_state: 'MA',
      tax_ids: [],
      has_company_details: true,
    };
    const { result } = renderHook(() => useVatInvoiceForm('US', profile));
    expect(result.current.form.addressLine2).toBe('Apt 12');
    await act(async () => {
      await result.current.save({
        address: {
          country: 'US',
          line1: '1 Main St',
          line2: null,
          city: 'Boston',
          postal_code: '02108',
        },
      });
    });
    expect(saved).toHaveBeenLastCalledWith(
      expect.objectContaining({ addressLine2: '' })
    );
  });
  it('omits an unknown line two in the legacy form so the saved value is preserved', async () => {
    const { result } = renderHook(() => useVatInvoiceForm('PL'));
    await act(async () => {
      await result.current.save();
    });
    expect(saved).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ addressLine2: expect.anything() })
    );
  });
  it('leaves existing tax IDs untouched when saving company details', async () => {
    const profile = {
      has_customer: true,
      company_name: 'Company',
      country: 'PL' as const,
      address_line1: 'Street',
      address_city: 'Kraków',
      address_postal_code: '30-001',
      address_state: null,
      tax_ids: [
        {
          type: 'eu_vat',
          value: 'PL1234567890',
          verification_status: 'pending',
        },
      ],
      has_company_details: true,
    };
    const { result } = renderHook(() => useVatInvoiceForm('PL', profile));
    act(() => result.current.setField('nip', ''));
    await act(async () => {
      await result.current.save();
    });
    expect(saved.mock.lastCall?.[0]).not.toHaveProperty('taxId');
  });
  it('recognizes an ID created during preview after profile refresh, even if editing is closed', async () => {
    const initial = {
      has_customer: true,
      company_name: null as string | null,
      country: 'PL' as const,
      address_line1: null,
      address_city: null,
      address_postal_code: null,
      address_state: null,
      tax_ids: [] as {
        type: string;
        value: string;
        verification_status: string | null;
      }[],
      has_company_details: false,
    };
    const { result, rerender } = renderHook(
      ({ profile }) => useVatInvoiceForm('PL', profile),
      { initialProps: { profile: initial } }
    );
    act(() => {
      result.current.setIsOn(true);
      result.current.setField('nip', '1234567890');
    });
    rerender({
      profile: {
        ...initial,
        company_name: 'Salon',
        has_company_details: true,
        tax_ids: [
          {
            type: 'eu_vat',
            value: 'PL1234567890',
            verification_status: 'pending',
          },
        ],
      },
    });
    act(() => result.current.setIsOn(false));
    expect(result.current.hasSavedCompany).toBe(true);
    expect(result.current.savedCompanyName).toBe('Salon');
    expect(result.current.savedTaxIds[0]?.value).toBe('PL1234567890');
    await act(async () => {
      await result.current.save();
    });
    expect(saved.mock.lastCall?.[0]).not.toHaveProperty('taxId');
  });
});
