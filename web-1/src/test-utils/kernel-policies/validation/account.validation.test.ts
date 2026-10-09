/**
 * Characterization tests for accountValidators (FWE Wave H, FAZA 1).
 *
 * These lock the CURRENT behavior of the kernel account request validators as the safety net
 * the zod migration (FAZA 2) must preserve — every assertion below is GREEN against the
 * hand-written validators, so a zod rewrite that changes a field's accept/reject decision
 * (or which field carries the error) flips a test. They assert the validation LOGIC
 * (which field is rejected, __isValid), NOT exact i18n message text (brittle) — a rejected
 * field is asserted via a non-empty error string, an accepted field via an empty one.
 *
 * Valid/boundary inputs are DERIVED from the SSOT configs (VALIDATION_LENGTHS, VALIDATION_GEO),
 * not hardcoded, so a limit change in the config moves these in lockstep.
 *
 * Follows the EXEMPLAR shape of gallery.validation.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import {
  VALIDATION_LENGTHS,
  VALIDATION_GEO,
} from '@kernel/policies/validation.config';
import { VALIDATION_MESSAGES } from '@kernel/domain/i18n/validation.i18n';

const V = VALIDATION_POLICY.validators;

// Helper: a field is "rejected" when its accumulated error string is non-empty.
const rejected = (r: Record<string, unknown>, field: string): boolean =>
  typeof r[field] === 'string' && (r[field] as string).trim().length > 0;

const SOME_ACCOUNT_TYPE = Object.values(AccountTypeValue)[0] as string;

describe('accountValidators.accountDisplayNameChange', () => {
  const validName = 'a'.repeat(VALIDATION_LENGTHS.DISPLAY_NAME_MIN);

  it('accepts a display_name at the min length', () => {
    const r = V.accountDisplayNameChange({ display_name: validName });
    expect(r.__isValid).toBe(true);
  });

  it('accepts a display_name at the max length', () => {
    const r = V.accountDisplayNameChange({
      display_name: 'a'.repeat(VALIDATION_LENGTHS.DISPLAY_NAME_MAX),
    });
    expect(r.__isValid).toBe(true);
  });

  it('rejects a non-string display_name (missing / wrong type)', () => {
    for (const bad of [undefined, null, 123, {}, []]) {
      const r = V.accountDisplayNameChange({
        display_name: bad as unknown as string,
      });
      expect(r.__isValid, `display_name=${JSON.stringify(bad)}`).toBe(false);
      expect(rejected(r, 'display_name')).toBe(true);
    }
  });

  it('rejects an empty-string display_name (below min length)', () => {
    const r = V.accountDisplayNameChange({ display_name: '' });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'display_name')).toBe(true);
  });

  it('rejects a display_name one char below the min length', () => {
    const r = V.accountDisplayNameChange({
      display_name: 'a'.repeat(VALIDATION_LENGTHS.DISPLAY_NAME_MIN - 1),
    });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'display_name')).toBe(true);
  });

  it('rejects a display_name one char above the max length', () => {
    const r = V.accountDisplayNameChange({
      display_name: 'a'.repeat(VALIDATION_LENGTHS.DISPLAY_NAME_MAX + 1),
    });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'display_name')).toBe(true);
  });
});

describe('accountValidators.accountGetStylistsWithLocation', () => {
  it('accepts an empty payload (lat/lng/radius all optional)', () => {
    const r = V.accountGetStylistsWithLocation({});
    expect(r.__isValid).toBe(true);
  });

  it('accepts in-range latitude / longitude / radius_km', () => {
    const r = V.accountGetStylistsWithLocation({
      latitude: 0,
      longitude: 0,
      radius_km: VALIDATION_GEO.RADIUS_KM_MAX,
    });
    expect(r.__isValid).toBe(true);
  });

  it('accepts boundary lat/lng values', () => {
    expect(
      V.accountGetStylistsWithLocation({
        latitude: VALIDATION_GEO.LATITUDE_MIN,
        longitude: VALIDATION_GEO.LONGITUDE_MIN,
      }).__isValid
    ).toBe(true);
    expect(
      V.accountGetStylistsWithLocation({
        latitude: VALIDATION_GEO.LATITUDE_MAX,
        longitude: VALIDATION_GEO.LONGITUDE_MAX,
      }).__isValid
    ).toBe(true);
  });

  it('rejects out-of-range latitude (below min / above max)', () => {
    const below = V.accountGetStylistsWithLocation({
      latitude: VALIDATION_GEO.LATITUDE_MIN - 1,
    });
    const above = V.accountGetStylistsWithLocation({
      latitude: VALIDATION_GEO.LATITUDE_MAX + 1,
    });
    expect(below.__isValid).toBe(false);
    expect(rejected(below, 'latitude')).toBe(true);
    expect(above.__isValid).toBe(false);
    expect(rejected(above, 'latitude')).toBe(true);
  });

  it('rejects out-of-range longitude (below min / above max)', () => {
    const below = V.accountGetStylistsWithLocation({
      longitude: VALIDATION_GEO.LONGITUDE_MIN - 1,
    });
    const above = V.accountGetStylistsWithLocation({
      longitude: VALIDATION_GEO.LONGITUDE_MAX + 1,
    });
    expect(rejected(below, 'longitude')).toBe(true);
    expect(rejected(above, 'longitude')).toBe(true);
  });

  it('rejects radius_km <= 0 and above the configured max', () => {
    expect(
      rejected(V.accountGetStylistsWithLocation({ radius_km: 0 }), 'radius_km')
    ).toBe(true);
    expect(
      rejected(V.accountGetStylistsWithLocation({ radius_km: -5 }), 'radius_km')
    ).toBe(true);
    expect(
      rejected(
        V.accountGetStylistsWithLocation({
          radius_km: VALIDATION_GEO.RADIUS_KM_MAX + 1,
        }),
        'radius_km'
      )
    ).toBe(true);
  });

  it('rejects non-number latitude/longitude/radius when present', () => {
    expect(
      V.accountGetStylistsWithLocation({
        latitude: '0' as unknown as number,
      }).__isValid
    ).toBe(false);
    expect(
      V.accountGetStylistsWithLocation({
        longitude: '0' as unknown as number,
      }).__isValid
    ).toBe(false);
    expect(
      V.accountGetStylistsWithLocation({
        radius_km: '5' as unknown as number,
      }).__isValid
    ).toBe(false);
  });
});

describe('accountValidators.updateStylistProfile', () => {
  const validLocation = {
    address_city: 'Warszawa',
  };

  it('rejects an empty payload (at least one sub-section required → __general)', () => {
    const r = V.updateStylistProfile({});
    expect(r.__isValid).toBe(false);
    expect(rejected(r, '__general')).toBe(true);
  });

  it('accepts a location-only payload with a valid city', () => {
    const r = V.updateStylistProfile({ location: validLocation });
    expect(r.__isValid).toBe(true);
  });

  it('rejects a non-string / too-short address_city', () => {
    expect(
      rejected(
        V.updateStylistProfile({
          location: { address_city: 123 as unknown as string },
        }),
        'location'
      )
    ).toBe(true);
    expect(
      rejected(
        V.updateStylistProfile({
          location: {
            address_city: 'a'.repeat(VALIDATION_LENGTHS.CITY_MIN - 1),
          },
        }),
        'location'
      )
    ).toBe(true);
  });

  it('rejects an over-long address_city', () => {
    const r = V.updateStylistProfile({
      location: { address_city: 'a'.repeat(VALIDATION_LENGTHS.CITY_MAX + 1) },
    });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'location')).toBe(true);
  });

  it('rejects over-long optional location fields (business_name/street/postal/phone/description)', () => {
    const cases: Array<[string, number]> = [
      ['business_name', VALIDATION_LENGTHS.BUSINESS_NAME_MAX],
      ['address_street', VALIDATION_LENGTHS.STREET_MAX],
      ['address_postal_code', VALIDATION_LENGTHS.POSTAL_CODE_MAX],
      ['address_country', VALIDATION_LENGTHS.COUNTRY_MAX],
      ['phone', VALIDATION_LENGTHS.PHONE_FIELD_MAX],
      ['description', VALIDATION_LENGTHS.DESCRIPTION_MAX],
    ];
    for (const [field, max] of cases) {
      const r = V.updateStylistProfile({
        location: {
          ...validLocation,
          [field]: 'a'.repeat(max + 1),
        } as never,
      });
      expect(r.__isValid, `field=${field}`).toBe(false);
      expect(rejected(r, 'location'), `field=${field}`).toBe(true);
    }
  });

  it('rejects a non-string address_country with the countryInvalid token (it reached Prisma → 500)', () => {
    for (const bad of [123, {}, true, ['PL']]) {
      const r = V.updateStylistProfile({
        location: {
          ...validLocation,
          address_country: bad as unknown as string,
        },
      });
      expect(r.__isValid, `address_country=${JSON.stringify(bad)}`).toBe(false);
      expect(r.location).toContain(VALIDATION_MESSAGES.location.countryInvalid);
    }
  });

  it('accepts a string / null / absent address_country', () => {
    for (const ok of ['Poland', 'PL', null, undefined]) {
      expect(
        V.updateStylistProfile({
          location: {
            ...validLocation,
            address_country: ok as unknown as string,
          },
        }).__isValid,
        `address_country=${String(ok)}`
      ).toBe(true);
    }
  });

  it('accepts a valid https website but rejects a non-https / executable-scheme website (XSS hardening)', () => {
    expect(
      V.updateStylistProfile({
        location: { ...validLocation, website: 'https://example.com' },
      }).__isValid
    ).toBe(true);

    for (const bad of [
      'http://example.com',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'https://user:pass@example.com',
      ' https://example.com',
    ]) {
      const r = V.updateStylistProfile({
        location: { ...validLocation, website: bad },
      });
      expect(r.__isValid, `website=${bad}`).toBe(false);
      expect(rejected(r, 'location'), `website=${bad}`).toBe(true);
    }
  });

  it('accepts a null/empty website (optional field)', () => {
    expect(
      V.updateStylistProfile({
        location: { ...validLocation, website: null },
      }).__isValid
    ).toBe(true);
    expect(
      V.updateStylistProfile({
        location: { ...validLocation, website: '' },
      }).__isValid
    ).toBe(true);
  });

  it('vanity: accepts null (skips validation) and a well-formed slug, rejects bad format/length/type', () => {
    expect(
      V.updateStylistProfile({ vanity: { vanity_url: null } }).__isValid
    ).toBe(true);
    expect(
      V.updateStylistProfile({
        vanity: { vanity_url: 'a'.repeat(VALIDATION_LENGTHS.VANITY_URL_MIN) },
      }).__isValid
    ).toBe(true);

    // Too short
    expect(
      rejected(
        V.updateStylistProfile({
          vanity: {
            vanity_url: 'a'.repeat(VALIDATION_LENGTHS.VANITY_URL_MIN - 1),
          },
        }),
        'vanity_url'
      )
    ).toBe(true);
    // Too long
    expect(
      rejected(
        V.updateStylistProfile({
          vanity: {
            vanity_url: 'a'.repeat(VALIDATION_LENGTHS.VANITY_URL_MAX + 1),
          },
        }),
        'vanity_url'
      )
    ).toBe(true);
    // Bad format (uppercase / spaces / unicode not allowed)
    expect(
      rejected(
        V.updateStylistProfile({ vanity: { vanity_url: 'Anna Kowalska' } }),
        'vanity_url'
      )
    ).toBe(true);
    // Wrong type
    expect(
      rejected(
        V.updateStylistProfile({
          vanity: { vanity_url: 123 as unknown as string },
        }),
        'vanity_url'
      )
    ).toBe(true);
  });

  it('social: a null or undefined instagram_handle skips validation and is accepted', () => {
    // The `social` object being present satisfies hasAny; a null/undefined handle
    // takes the `ig !== undefined && ig !== null` guard → no instagram_handle check
    // runs → result is valid. (Characterizes: an empty social section is NOT an error.)
    expect(
      V.updateStylistProfile({ social: { instagram_handle: null } }).__isValid
    ).toBe(true);
    expect(
      V.updateStylistProfile({ social: { instagram_handle: undefined } })
        .__isValid
    ).toBe(true);
  });

  it('social: a present valid instagram_handle passes', () => {
    const r = V.updateStylistProfile({
      social: { instagram_handle: 'anna_nails.99' },
    });
    expect(r.__isValid).toBe(true);
  });

  it('social: rejects an over-long instagram_handle and invalid chars', () => {
    expect(
      rejected(
        V.updateStylistProfile({
          social: { instagram_handle: 'a'.repeat(31) },
        }),
        'instagram_handle'
      )
    ).toBe(true);
    expect(
      rejected(
        V.updateStylistProfile({
          social: { instagram_handle: 'anna kowalska!' },
        }),
        'instagram_handle'
      )
    ).toBe(true);
  });

  it('social: rejects a non-string instagram_handle', () => {
    expect(
      rejected(
        V.updateStylistProfile({
          social: { instagram_handle: 123 as unknown as string },
        }),
        'instagram_handle'
      )
    ).toBe(true);
  });
});

describe('accountValidators.accountIncrementView', () => {
  it('accepts a non-empty string stylist_account_id', () => {
    expect(
      V.accountIncrementView({ stylist_account_id: 'acc-1' }).__isValid
    ).toBe(true);
  });

  it('rejects an empty / missing / non-string stylist_account_id', () => {
    for (const bad of ['', undefined, null, 123, {}]) {
      const r = V.accountIncrementView({
        stylist_account_id: bad as unknown as string,
      });
      expect(r.__isValid, `id=${JSON.stringify(bad)}`).toBe(false);
      expect(rejected(r, 'stylist_account_id')).toBe(true);
    }
  });
});

describe('accountValidators.accountSetDashboardNote', () => {
  const valid = { note: 'hello', account_type: SOME_ACCOUNT_TYPE };

  it('accepts a string note + valid account_type', () => {
    const r = V.accountSetDashboardNote({ ...valid });
    expect(r.__isValid).toBe(true);
  });

  it('accepts a null note (clearing the note) with a valid account_type', () => {
    const r = V.accountSetDashboardNote({
      note: null,
      account_type: SOME_ACCOUNT_TYPE,
    });
    expect(r.__isValid).toBe(true);
  });

  it('rejects a non-string, non-null note', () => {
    const r = V.accountSetDashboardNote({
      note: 123 as unknown as string,
      account_type: SOME_ACCOUNT_TYPE,
    });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'note')).toBe(true);
  });

  it('rejects an over-long note', () => {
    const r = V.accountSetDashboardNote({
      note: 'a'.repeat(VALIDATION_LENGTHS.DASHBOARD_NOTE_MAX + 1),
      account_type: SOME_ACCOUNT_TYPE,
    });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'note')).toBe(true);
  });

  it('rejects a missing / invalid account_type', () => {
    for (const bad of [undefined, null, '', 'ADMIN', 'STYLISTS']) {
      const r = V.accountSetDashboardNote({
        note: 'hello',
        account_type: bad as unknown as string,
      });
      expect(r.__isValid, `account_type=${JSON.stringify(bad)}`).toBe(false);
      expect(rejected(r, 'account_type')).toBe(true);
    }
  });

  it('accepts every valid AccountTypeValue', () => {
    for (const type of Object.values(AccountTypeValue)) {
      const r = V.accountSetDashboardNote({
        note: 'hello',
        account_type: type,
      });
      expect(r.__isValid, `account_type=${type}`).toBe(true);
    }
  });
});

describe('accountValidators.vatInvoiceDetails (Faktura VAT)', () => {
  // Synthetic checksum-valid Polish NIP (all-ones passes the modulo-11 check) —
  // deliberately NOT the owner's real NIP (PII plaintext guard forbids leaking it).
  const VALID = {
    companyName: 'Studio Paznokci Anna Kowalska',
    nip: '1111111111',
    addressLine1: 'ul. Kwiatowa 12/3',
    addressCity: 'Warszawa',
    addressPostalCode: '00-950',
  };

  it('accepts a fully valid company invoice payload', () => {
    const r = V.vatInvoiceDetails(VALID);
    expect(r.__isValid).toBe(true);
  });

  it('accepts a NIP with spaces / dashes / PL prefix (normalized before checksum)', () => {
    for (const nip of ['111-111-11-11', 'PL1111111111', '111 111 11 11']) {
      const r = V.vatInvoiceDetails({ ...VALID, nip });
      expect(r.__isValid, `nip=${nip}`).toBe(true);
    }
  });

  it('rejects a NIP that fails the modulo-11 checksum', () => {
    // 1111111112 = the valid all-ones NIP with the last (check) digit flipped 1→2.
    const r = V.vatInvoiceDetails({ ...VALID, nip: '1111111112' });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'nip')).toBe(true);
  });

  it('rejects NIPs of the wrong length / non-numeric', () => {
    for (const nip of ['123', '12345678901', 'abcdefghij', '', '111111111x']) {
      const r = V.vatInvoiceDetails({ ...VALID, nip });
      expect(r.__isValid, `nip=${nip}`).toBe(false);
      expect(rejected(r, 'nip')).toBe(true);
    }
  });

  it('rejects a postal code that is not the PL NN-NNN format', () => {
    for (const postal of ['00950', '1-234', '000-00', 'ABC']) {
      const r = V.vatInvoiceDetails({ ...VALID, addressPostalCode: postal });
      expect(r.__isValid, `postal=${postal}`).toBe(false);
      expect(rejected(r, 'addressPostalCode')).toBe(true);
    }
  });

  it('rejects empty / missing required text fields', () => {
    for (const field of [
      'companyName',
      'addressLine1',
      'addressCity',
    ] as const) {
      const r = V.vatInvoiceDetails({ ...VALID, [field]: '' });
      expect(r.__isValid, `field=${field}`).toBe(false);
      expect(rejected(r, field)).toBe(true);
    }
  });

  it('rejects whitespace-only company name / street / city (trim przed min)', () => {
    // Regresja: bez `.trim()` przed `.min()` `'   '` przechodziło po surowej
    // długości i tożsamość do faktury zapisywała się z pustymi danymi nabywcy
    // przy poprawnym NIP-ie. Frontend trimował — backend nie (client/server drift
    // omijalny surowym POST-em).
    for (const field of [
      'companyName',
      'addressLine1',
      'addressCity',
    ] as const) {
      for (const blank of ['   ', '\t\n', '   ']) {
        const r = V.vatInvoiceDetails({ ...VALID, [field]: blank });
        expect(
          r.__isValid,
          `field=${field} blank=${JSON.stringify(blank)}`
        ).toBe(false);
        expect(rejected(r, field)).toBe(true);
      }
    }
  });

  it('rejects a non-object body (coalesced to {}) with all fields flagged', () => {
    const r = V.vatInvoiceDetails(null);
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'companyName')).toBe(true);
    expect(rejected(r, 'nip')).toBe(true);
  });
});
