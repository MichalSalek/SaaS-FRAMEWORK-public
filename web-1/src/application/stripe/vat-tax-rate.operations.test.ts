import { beforeEach, describe, expect, it, vi } from 'vitest';

const { taxRatesList, taxRatesCreate, reportIssueBackend } = vi.hoisted(() => ({
  taxRatesList: vi.fn(),
  taxRatesCreate: vi.fn(),
  reportIssueBackend: vi.fn(),
}));

vi.mock('@app/stripe/adapters/stripe.adapter', () => ({
  getStripe: () => ({
    taxRates: { list: taxRatesList, create: taxRatesCreate },
  }),
}));

vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend }));

const makeTaxRate = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  id: 'txr_nailfolio_inclusive',
  object: 'tax_rate',
  active: true,
  country: 'PL',
  created: 1,
  description: 'VAT 23% (PL, usluga elektroniczna)',
  display_name: 'VAT',
  effective_percentage: null,
  flat_amount: null,
  inclusive: true,
  jurisdiction: 'PL',
  jurisdiction_level: null,
  livemode: false,
  metadata: { projectId: 'nailfolio', kind: 'vat_pl_23' },
  percentage: 23,
  rate_type: 'percentage',
  state: null,
  tax_type: 'vat',
  ...overrides,
});

const loadSubject = async () => {
  vi.resetModules();
  const { getOrCreateVatTaxRate } = await import('./vat-tax-rate.operations');
  return getOrCreateVatTaxRate;
};

const stripeError = (message: string) =>
  Object.assign(new Error(message), { statusCode: 400 });

describe('getOrCreateVatTaxRate', () => {
  beforeEach(() => {
    taxRatesList.mockReset();
    taxRatesCreate.mockReset();
    reportIssueBackend.mockReset();
    taxRatesList.mockResolvedValue({ data: [], has_more: false });
    taxRatesCreate.mockResolvedValue(makeTaxRate({ id: 'txr_created' }));
  });

  it('reuses only an active, scoped, inclusive Polish 23% VAT rate', async () => {
    const getOrCreateVatTaxRate = await loadSubject();
    taxRatesList.mockResolvedValue({
      data: [makeTaxRate({ id: 'txr_existing' })],
      has_more: false,
    });

    await expect(getOrCreateVatTaxRate()).resolves.toBe('txr_existing');

    expect(taxRatesList).toHaveBeenCalledWith({
      active: true,
      inclusive: true,
      limit: 100,
    });
    expect(taxRatesCreate).not.toHaveBeenCalled();
  });

  it('rejects a legacy exclusive rate and wrong or foreign candidates', async () => {
    const getOrCreateVatTaxRate = await loadSubject();
    taxRatesList.mockResolvedValue({
      data: [
        makeTaxRate({ id: 'txr_old_exclusive', inclusive: false }),
        makeTaxRate({ id: 'txr_wrong_percentage', percentage: 8 }),
        makeTaxRate({ id: 'txr_wrong_country', country: 'DE' }),
        makeTaxRate({
          id: 'txr_foreign_project',
          metadata: { projectId: 'other-example', kind: 'vat_pl_23' },
        }),
      ],
      has_more: false,
    });

    await expect(getOrCreateVatTaxRate()).resolves.toBe('txr_created');

    expect(taxRatesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        percentage: 23,
        inclusive: true,
        country: 'PL',
        jurisdiction: 'PL',
        tax_type: 'vat',
        metadata: { projectId: 'nailfolio', kind: 'vat_pl_23' },
      })
    );
  });

  it('paginates until it finds the scoped rate beyond the first 100', async () => {
    const getOrCreateVatTaxRate = await loadSubject();
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      makeTaxRate({
        id: `txr_foreign_${index}`,
        metadata: { projectId: 'other-example', kind: 'vat_pl_23' },
      })
    );
    taxRatesList
      .mockResolvedValueOnce({ data: firstPage, has_more: true })
      .mockResolvedValueOnce({
        data: [makeTaxRate({ id: 'txr_page_two' })],
        has_more: false,
      });

    await expect(getOrCreateVatTaxRate()).resolves.toBe('txr_page_two');

    expect(taxRatesList).toHaveBeenNthCalledWith(1, {
      active: true,
      inclusive: true,
      limit: 100,
    });
    expect(taxRatesList).toHaveBeenNthCalledWith(2, {
      active: true,
      inclusive: true,
      limit: 100,
      starting_after: 'txr_foreign_99',
    });
    expect(taxRatesCreate).not.toHaveBeenCalled();
  });

  it('caches the accepted rate for later calls in the same process', async () => {
    const getOrCreateVatTaxRate = await loadSubject();

    await expect(getOrCreateVatTaxRate()).resolves.toBe('txr_created');
    await expect(getOrCreateVatTaxRate()).resolves.toBe('txr_created');

    expect(taxRatesList).toHaveBeenCalledTimes(1);
    expect(taxRatesCreate).toHaveBeenCalledTimes(1);
  });

  it('does not create a rate when Stripe listing fails', async () => {
    const getOrCreateVatTaxRate = await loadSubject();
    taxRatesList.mockRejectedValue(stripeError('list failed'));

    await expect(getOrCreateVatTaxRate()).rejects.toThrow('list failed');
    expect(taxRatesCreate).not.toHaveBeenCalled();
  });

  it('surfaces a Stripe create failure without caching a missing rate', async () => {
    const getOrCreateVatTaxRate = await loadSubject();
    taxRatesCreate.mockRejectedValue(stripeError('create failed'));

    await expect(getOrCreateVatTaxRate()).rejects.toThrow('create failed');
    expect(taxRatesCreate).toHaveBeenCalledTimes(1);
  });
});
