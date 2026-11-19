import { describe, expect, it } from 'vitest';
import {
  formatPublicAddress,
  readAddressStreet,
  publicAddressMapHref,
} from './_profile-address.helpers';

describe('formatPublicAddress', () => {
  it('joins the city and the street', () => {
    expect(formatPublicAddress('Kraków', 'ul. Mokotowska 12')).toBe(
      'Kraków, ul. Mokotowska 12'
    );
  });

  it('shows the city alone when the street is empty', () => {
    expect(formatPublicAddress('Kraków', '  ')).toBe('Kraków');
    expect(formatPublicAddress('Kraków', null)).toBe('Kraków');
  });

  it('hides a street that has no city', () => {
    expect(formatPublicAddress(null, 'ul. Mokotowska 12')).toBeNull();
    expect(formatPublicAddress('  ', 'ul. Mokotowska 12')).toBeNull();
  });
});

describe('publicAddressMapHref', () => {
  it('keeps the full typed address in one encoded query without using approximate coordinates', () => {
    const address = 'Kraków, ul. Długa 12/4 & wejście #2';
    const url = new URL(publicAddressMapHref(address));
    expect(url.origin).toBe('https://www.google.com');
    expect(url.pathname).toBe('/maps/search/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('query')).toBe(address);
    expect(url.hash).toBe('');
  });
});

describe('readAddressStreet', () => {
  it('reads a street from a profile payload and ignores blanks', () => {
    expect(readAddressStreet({ address_street: 'ul. Długa 1' })).toBe(
      'ul. Długa 1'
    );
    expect(readAddressStreet({ address_street: '  ' })).toBeNull();
    expect(readAddressStreet({ address_city: 'Kraków' })).toBeNull();
  });
});
