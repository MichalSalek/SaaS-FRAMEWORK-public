import { describe, expect, it } from 'vitest';
import {
  addressSectionFrom,
  planAddressWrite,
  reconcileAddressWrite,
  type StoredAddress,
} from './account-address-write.helpers';

const stored: StoredAddress = {
  address_street: 'Ul. Długa 1',
  address_city: 'Kraków',
  address_postal_code: '30-001',
  address_country: 'PL',
};

describe('planAddressWrite', () => {
  it('does not invent Poland when no country is known', () => {
    const plan = planAddressWrite({ address_city: 'East Hartford' }, null);
    expect(plan).toMatchObject({ ok: true, geocode: null });
    if (plan.ok) {
      expect(plan.patch.address_country).not.toBe('Poland');
    }
  });

  it('normalizes a selected country and clears a pin when the country changes', () => {
    const plan = planAddressWrite(
      { address_country: 'Germany' },
      { ...stored, address_city: 'Berlin' }
    );
    expect(plan).toMatchObject({
      ok: true,
      patch: { address_country: 'DE' },
      clearCoordinates: true,
      geocode: { country: 'DE' },
    });
  });
  it('preserves punctuation and apartment numbers in a street address', () => {
    const result = planAddressWrite(
      { address_city: 'Kraków', address_street: ' ul. Długa 12/4 ' },
      stored
    );
    expect(result).toMatchObject({
      ok: true,
      patch: { address_street: 'ul. Długa 12/4' },
    });
  });
  it('refuses a city clear when another writer added a street after preflight', () => {
    const before = { ...stored, address_street: null };
    expect(planAddressWrite({ address_city: null }, before).ok).toBe(true);
    expect(
      reconcileAddressWrite(
        { address_city: null },
        { ...before, address_street: 'Długa 12' },
        null
      )
    ).toEqual({ ok: false });
  });
  it('discards coordinates resolved for an address changed by another writer', () => {
    const query = {
      city: 'Warszawa',
      street: 'Długa 12',
      postal_code: '00-001',
      country: 'PL',
    };
    const fresh = reconcileAddressWrite(
      { address_city: 'Warszawa', address_street: 'Długa 12' },
      { ...stored, address_postal_code: '00-002' },
      { query, latitude: 52.1, longitude: 21.1 }
    );
    expect(fresh.ok).toBe(true);
    if (fresh.ok) {
      expect(fresh.patch).not.toHaveProperty('latitude');
      expect(fresh.patch).not.toHaveProperty('longitude');
    }
  });
  it('leaves coordinates alone when the payload has no address keys', () => {
    expect(planAddressWrite({}, stored)).toEqual({
      ok: true,
      patch: {},
      geocode: null,
      clearCoordinates: false,
    });
  });

  it('geocodes only when the city remains and the address changed', () => {
    const plan = planAddressWrite(
      { address_city: 'Warszawa', address_street: 'ul. Mokotowska 12' },
      stored
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.clearCoordinates).toBe(false);
    expect(plan.geocode).toEqual({
      street: 'ul. Mokotowska 12',
      city: 'Warszawa',
      postal_code: '30-001',
      country: 'PL',
    });
    expect(plan.patch).toEqual({
      address_city: 'Warszawa',
      address_street: 'ul. Mokotowska 12',
    });
  });

  it('does not geocode when the merged address is unchanged', () => {
    const plan = planAddressWrite({ address_city: 'Kraków' }, stored);
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.geocode).toBeNull();
    expect(plan.clearCoordinates).toBe(false);
  });

  it('clears coordinates when the city is removed and the street is empty', () => {
    const plan = planAddressWrite(
      { address_city: null, address_street: '' },
      stored
    );
    expect(plan).toMatchObject({
      ok: true,
      clearCoordinates: true,
      geocode: null,
      patch: { address_city: null, address_street: null },
    });
  });

  it('refuses a street when no city remains', () => {
    expect(
      planAddressWrite(
        { address_street: 'ul. Mokotowska 12' },
        {
          ...stored,
          address_city: null,
        }
      )
    ).toEqual({ ok: false });
    expect(
      planAddressWrite(
        { address_city: '  ', address_street: 'ul. Mokotowska 12' },
        stored
      )
    ).toEqual({ ok: false });
  });
});

describe('addressSectionFrom', () => {
  it('copies only address keys that the payload actually sent', () => {
    expect(
      addressSectionFrom({
        phone: '+48 500 100 200',
        address_city: null,
        pricing_plan: 'SCALE',
      })
    ).toEqual({ address_city: null });
  });
});
