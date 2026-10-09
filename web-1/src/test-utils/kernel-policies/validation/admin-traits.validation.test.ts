/**
 * Characterization tests for adminTraitsValidators (FWE Wave H, FAZA 1).
 *
 * These lock the CURRENT behavior of the kernel admin-colors/admin-traits request
 * validators as the safety net the zod migration (FAZA 2) must preserve — every
 * assertion below is GREEN against the hand-written validators, so a zod rewrite that
 * changes a field's accept/reject decision (or which field carries the error) flips a
 * test. They assert the validation LOGIC (which field is rejected, __isValid), NOT exact
 * i18n message text (brittle) — a rejected field = a non-empty accumulated error string,
 * an accepted field = an empty one.
 *
 * The validators are reached through the public policy surface
 * (VALIDATION_POLICY.validators), where adminTraitsValidators is spread via
 * adminValidators — the same entry point handlers use.
 *
 * Valid/boundary inputs are DERIVED from the SSOT configs (VALIDATION_LENGTHS,
 * VALIDATION_BULK, TRAIT_CATEGORIES), not hardcoded, so a limit change in the config
 * moves these in lockstep.
 *
 * SECURITY focus: icon_url flows through validateOptionalHttpsUrl (XSS hardening) — the
 * https://-only allowlist (reject javascript:/data:/http:/vbscript:/file:/credentials)
 * is pinned here so the migration cannot silently widen the URI scheme allowlist.
 *
 * Follows the EXEMPLAR shape of gallery.validation.test.ts (FAZA 1 fan-out).
 */
import { describe, it, expect } from 'vitest';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import {
  VALIDATION_LENGTHS,
  VALIDATION_BULK,
} from '@kernel/policies/validation.config';
import { TRAIT_CATEGORIES } from '@kernel/domain/admin/traits.config';

const V = VALIDATION_POLICY.validators;

// Helper: a field is "rejected" when its accumulated error string is non-empty.
const rejected = (r: Record<string, unknown>, field: string): boolean =>
  typeof r[field] === 'string' && (r[field] as string).trim().length > 0;

const VALID_HEX = '#1A2B3C';
const SOME_CATEGORY = TRAIT_CATEGORIES[0] as string;
const VALID_HTTPS_ICON = 'https://res.cloudinary.com/demo/icon.svg';

describe('adminTraitsValidators.getColors / getTraits (always-valid passthrough)', () => {
  it('getColors is unconditionally valid, ignoring its input', () => {
    expect(V.getColors(undefined).__isValid).toBe(true);
    expect(V.getColors({ anything: 'goes' }).__isValid).toBe(true);
    expect(V.getColors(null).__isValid).toBe(true);
  });

  it('getTraits is unconditionally valid, ignoring its input', () => {
    expect(V.getTraits(undefined).__isValid).toBe(true);
    expect(V.getTraits({ anything: 'goes' }).__isValid).toBe(true);
    expect(V.getTraits(null).__isValid).toBe(true);
  });
});

describe('adminTraitsValidators.adminCreateColor', () => {
  const valid = {
    name: 'Coral',
    hex_code: VALID_HEX,
  };

  it('accepts a well-formed color (name + hex_code, display_order optional)', () => {
    expect(V.adminCreateColor({ ...valid }).__isValid).toBe(true);
    expect(
      V.adminCreateColor({
        ...valid,
        display_order: VALIDATION_BULK.MIN_DISPLAY_ORDER,
      }).__isValid
    ).toBe(true);
  });

  it('rejects a missing / non-string name', () => {
    for (const bad of ['', undefined, 123 as unknown as string]) {
      const r = V.adminCreateColor({ ...valid, name: bad as string });
      expect(r.__isValid, `name=${String(bad)}`).toBe(false);
      expect(rejected(r, 'name'), `name=${String(bad)}`).toBe(true);
    }
  });

  it('enforces COLOR_NAME_MAX on the trimmed name (boundary derived from config)', () => {
    const atMax = 'x'.repeat(VALIDATION_LENGTHS.COLOR_NAME_MAX);
    const overMax = 'x'.repeat(VALIDATION_LENGTHS.COLOR_NAME_MAX + 1);
    expect(V.adminCreateColor({ ...valid, name: atMax }).__isValid).toBe(true);
    expect(
      rejected(V.adminCreateColor({ ...valid, name: overMax }), 'name')
    ).toBe(true);
  });

  it('rejects a name that is whitespace-only (trims below COLOR_NAME_MIN)', () => {
    // COLOR_NAME_MIN is 1, so a single space trims to length 0 → below min.
    const r = V.adminCreateColor({ ...valid, name: '   ' });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'name')).toBe(true);
  });

  it('rejects a hex_code that is missing or not #RRGGBB', () => {
    for (const bad of ['', 'red', '#FFF', '1A2B3C', '#1A2B3G', '#1a2b3c4d']) {
      const r = V.adminCreateColor({ ...valid, hex_code: bad });
      expect(r.__isValid, `hex=${bad}`).toBe(false);
      expect(rejected(r, 'hex_code'), `hex=${bad}`).toBe(true);
    }
  });

  it('accepts lowercase and uppercase hex digits (case-insensitive #RRGGBB)', () => {
    expect(
      V.adminCreateColor({ ...valid, hex_code: '#abcdef' }).__isValid
    ).toBe(true);
    expect(
      V.adminCreateColor({ ...valid, hex_code: '#ABCDEF' }).__isValid
    ).toBe(true);
  });

  it('rejects a display_order that is non-number or below MIN_DISPLAY_ORDER', () => {
    expect(
      rejected(
        V.adminCreateColor({
          ...valid,
          display_order: 'x' as unknown as number,
        }),
        'display_order'
      )
    ).toBe(true);
    expect(
      rejected(
        V.adminCreateColor({
          ...valid,
          display_order: VALIDATION_BULK.MIN_DISPLAY_ORDER - 1,
        }),
        'display_order'
      )
    ).toBe(true);
  });
});

describe('adminTraitsValidators.adminUpdateColor (partial update)', () => {
  it('requires a string color_id', () => {
    expect(V.adminUpdateColor({ color_id: 'c1' }).__isValid).toBe(true);
    expect(V.adminUpdateColor({ color_id: '' }).__isValid).toBe(false);
    expect(
      rejected(
        V.adminUpdateColor({ color_id: 123 as unknown as string }),
        'color_id'
      )
    ).toBe(true);
  });

  it('PARTIAL: omitted optional fields are NOT validated (id-only is valid)', () => {
    expect(V.adminUpdateColor({ color_id: 'c1' }).__isValid).toBe(true);
  });

  it('PARTIAL: a PROVIDED name IS validated against COLOR_NAME bounds', () => {
    expect(
      rejected(
        V.adminUpdateColor({
          color_id: 'c1',
          name: 'x'.repeat(VALIDATION_LENGTHS.COLOR_NAME_MAX + 1),
        }),
        'name'
      )
    ).toBe(true);
    expect(V.adminUpdateColor({ color_id: 'c1', name: 'OK' }).__isValid).toBe(
      true
    );
  });

  it('PARTIAL: a PROVIDED hex_code IS validated', () => {
    expect(
      rejected(
        V.adminUpdateColor({ color_id: 'c1', hex_code: 'nope' }),
        'hex_code'
      )
    ).toBe(true);
    expect(
      V.adminUpdateColor({ color_id: 'c1', hex_code: VALID_HEX }).__isValid
    ).toBe(true);
  });

  it('SECURITY (CT-1): a PROVIDED non-boolean is_active is rejected (no silent 500)', () => {
    const r = V.adminUpdateColor({
      color_id: 'c1',
      is_active: 'yes' as unknown as boolean,
    });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'is_active')).toBe(true);
    // boolean values pass
    expect(
      V.adminUpdateColor({ color_id: 'c1', is_active: true }).__isValid
    ).toBe(true);
    expect(
      V.adminUpdateColor({ color_id: 'c1', is_active: false }).__isValid
    ).toBe(true);
  });
});

describe('adminTraitsValidators.adminDeleteColor', () => {
  it('requires a string color_id and nothing else', () => {
    expect(V.adminDeleteColor({ color_id: 'c1' }).__isValid).toBe(true);
    expect(V.adminDeleteColor({ color_id: '' }).__isValid).toBe(false);
    expect(
      rejected(
        V.adminDeleteColor({ color_id: 123 as unknown as string }),
        'color_id'
      )
    ).toBe(true);
  });
});

describe('adminTraitsValidators.adminCreateTrait', () => {
  const valid = {
    name: 'Glitter',
    category: SOME_CATEGORY,
  };

  it('accepts a well-formed trait (name + category; icon_url/display_order/is_featured optional)', () => {
    expect(V.adminCreateTrait({ ...valid }).__isValid).toBe(true);
    expect(
      V.adminCreateTrait({ ...valid, icon_url: VALID_HTTPS_ICON }).__isValid
    ).toBe(true);
  });

  it('rejects a missing / non-string name and enforces TRAIT_NAME_MAX', () => {
    expect(rejected(V.adminCreateTrait({ ...valid, name: '' }), 'name')).toBe(
      true
    );
    expect(
      rejected(
        V.adminCreateTrait({ ...valid, name: 123 as unknown as string }),
        'name'
      )
    ).toBe(true);
    expect(
      V.adminCreateTrait({
        ...valid,
        name: 'x'.repeat(VALIDATION_LENGTHS.TRAIT_NAME_MAX),
      }).__isValid
    ).toBe(true);
    expect(
      rejected(
        V.adminCreateTrait({
          ...valid,
          name: 'x'.repeat(VALIDATION_LENGTHS.TRAIT_NAME_MAX + 1),
        }),
        'name'
      )
    ).toBe(true);
  });

  it('rejects a category not in TRAIT_CATEGORIES and accepts every valid one', () => {
    expect(
      rejected(V.adminCreateTrait({ ...valid, category: 'NOPE' }), 'category')
    ).toBe(true);
    expect(
      rejected(V.adminCreateTrait({ ...valid, category: '' }), 'category')
    ).toBe(true);
    for (const cat of TRAIT_CATEGORIES) {
      expect(
        V.adminCreateTrait({ ...valid, category: cat }).__isValid,
        cat
      ).toBe(true);
    }
  });

  it('SECURITY: icon_url is HTTPS-only — rejects javascript:/data:/http:/vbscript:/file: and embedded credentials', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'http://res.cloudinary.com/icon.svg',
      'ftp://example.com/icon.svg',
      'https://user:pass@example.com/icon.svg',
      '  https://example.com/icon.svg',
      'https://example.com/icon.svg\n',
      'https:',
    ]) {
      const r = V.adminCreateTrait({ ...valid, icon_url: bad });
      expect(r.__isValid, `icon_url=${JSON.stringify(bad)}`).toBe(false);
      expect(rejected(r, 'icon_url'), `icon_url=${JSON.stringify(bad)}`).toBe(
        true
      );
    }
  });

  it('SECURITY: icon_url accepts a clean https URL, empty string, and absence (optional)', () => {
    expect(
      V.adminCreateTrait({ ...valid, icon_url: VALID_HTTPS_ICON }).__isValid
    ).toBe(true);
    expect(V.adminCreateTrait({ ...valid, icon_url: '' }).__isValid).toBe(true);
    expect(V.adminCreateTrait({ ...valid }).__isValid).toBe(true);
  });

  it('SECURITY: icon_url over ICON_URL_MAX is rejected (size cap, boundary from config)', () => {
    const longHost = 'x'.repeat(VALIDATION_LENGTHS.ICON_URL_MAX);
    const overLong = `https://${longHost}.com/i.svg`;
    expect(overLong.length).toBeGreaterThan(VALIDATION_LENGTHS.ICON_URL_MAX);
    expect(
      rejected(V.adminCreateTrait({ ...valid, icon_url: overLong }), 'icon_url')
    ).toBe(true);
  });

  it('SECURITY: a non-string icon_url (number/object) is rejected', () => {
    expect(
      rejected(
        V.adminCreateTrait({ ...valid, icon_url: 123 as unknown as string }),
        'icon_url'
      )
    ).toBe(true);
    expect(
      rejected(
        V.adminCreateTrait({ ...valid, icon_url: {} as unknown as string }),
        'icon_url'
      )
    ).toBe(true);
  });

  it('rejects a non-number / below-min display_order and a non-boolean is_featured', () => {
    expect(
      rejected(
        V.adminCreateTrait({
          ...valid,
          display_order: VALIDATION_BULK.MIN_DISPLAY_ORDER - 1,
        }),
        'display_order'
      )
    ).toBe(true);
    expect(
      rejected(
        V.adminCreateTrait({
          ...valid,
          is_featured: 'yes' as unknown as boolean,
        }),
        'is_featured'
      )
    ).toBe(true);
    expect(V.adminCreateTrait({ ...valid, is_featured: true }).__isValid).toBe(
      true
    );
  });
});

describe('adminTraitsValidators.adminUpdateTrait (partial update)', () => {
  it('requires a string trait_id', () => {
    expect(V.adminUpdateTrait({ trait_id: 't1' }).__isValid).toBe(true);
    expect(V.adminUpdateTrait({ trait_id: '' }).__isValid).toBe(false);
    expect(
      rejected(
        V.adminUpdateTrait({ trait_id: 123 as unknown as string }),
        'trait_id'
      )
    ).toBe(true);
  });

  it('PARTIAL: omitted optional fields are NOT validated (id-only is valid)', () => {
    expect(V.adminUpdateTrait({ trait_id: 't1' }).__isValid).toBe(true);
  });

  it('PARTIAL: a PROVIDED name IS validated against TRAIT_NAME bounds', () => {
    expect(
      rejected(
        V.adminUpdateTrait({
          trait_id: 't1',
          name: 'x'.repeat(VALIDATION_LENGTHS.TRAIT_NAME_MAX + 1),
        }),
        'name'
      )
    ).toBe(true);
    expect(V.adminUpdateTrait({ trait_id: 't1', name: 'OK' }).__isValid).toBe(
      true
    );
  });

  it('PARTIAL: a PROVIDED category must be in TRAIT_CATEGORIES', () => {
    expect(
      rejected(
        V.adminUpdateTrait({ trait_id: 't1', category: 'NOPE' }),
        'category'
      )
    ).toBe(true);
    expect(
      V.adminUpdateTrait({ trait_id: 't1', category: SOME_CATEGORY }).__isValid
    ).toBe(true);
  });

  it('CHARACTERIZATION: a PROVIDED non-string category (number) also fails the allowlist (no typeof guard, but .includes still rejects)', () => {
    // Unlike create, update has no `typeof category !== 'string'` guard — a defined
    // non-string still fails `TRAIT_CATEGORIES.includes(...)` and is rejected.
    expect(
      rejected(
        V.adminUpdateTrait({
          trait_id: 't1',
          category: 123 as unknown as string,
        }),
        'category'
      )
    ).toBe(true);
  });

  it('SECURITY: a PROVIDED icon_url is HTTPS-only (reject javascript:/http:), accepts clean https', () => {
    expect(
      rejected(
        V.adminUpdateTrait({ trait_id: 't1', icon_url: 'javascript:alert(1)' }),
        'icon_url'
      )
    ).toBe(true);
    expect(
      rejected(
        V.adminUpdateTrait({
          trait_id: 't1',
          icon_url: 'http://example.com/i.svg',
        }),
        'icon_url'
      )
    ).toBe(true);
    expect(
      V.adminUpdateTrait({ trait_id: 't1', icon_url: VALID_HTTPS_ICON })
        .__isValid
    ).toBe(true);
    // empty string = no URL provided (optional) → still valid
    expect(V.adminUpdateTrait({ trait_id: 't1', icon_url: '' }).__isValid).toBe(
      true
    );
  });

  it('SECURITY (CT-1): a PROVIDED non-boolean is_active / is_featured is rejected', () => {
    expect(
      rejected(
        V.adminUpdateTrait({
          trait_id: 't1',
          is_active: 'yes' as unknown as boolean,
        }),
        'is_active'
      )
    ).toBe(true);
    expect(
      rejected(
        V.adminUpdateTrait({
          trait_id: 't1',
          is_featured: 1 as unknown as boolean,
        }),
        'is_featured'
      )
    ).toBe(true);
    expect(
      V.adminUpdateTrait({
        trait_id: 't1',
        is_active: true,
        is_featured: false,
      }).__isValid
    ).toBe(true);
  });

  it('rejects a non-number / below-min display_order when provided', () => {
    expect(
      rejected(
        V.adminUpdateTrait({
          trait_id: 't1',
          display_order: VALIDATION_BULK.MIN_DISPLAY_ORDER - 1,
        }),
        'display_order'
      )
    ).toBe(true);
    expect(
      V.adminUpdateTrait({
        trait_id: 't1',
        display_order: VALIDATION_BULK.MIN_DISPLAY_ORDER,
      }).__isValid
    ).toBe(true);
  });
});

describe('adminTraitsValidators.adminDeleteTrait', () => {
  it('requires a string trait_id and nothing else', () => {
    expect(V.adminDeleteTrait({ trait_id: 't1' }).__isValid).toBe(true);
    expect(V.adminDeleteTrait({ trait_id: '' }).__isValid).toBe(false);
    expect(
      rejected(
        V.adminDeleteTrait({ trait_id: 123 as unknown as string }),
        'trait_id'
      )
    ).toBe(true);
  });
});
