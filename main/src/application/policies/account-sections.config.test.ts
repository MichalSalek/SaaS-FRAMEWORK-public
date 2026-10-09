import { describe, expect, it } from 'vitest';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  ACCOUNT_SECTIONS,
  ACCOUNT_SECTION_IDS,
  buildAccountSectionHref,
  getAccountSectionDef,
  resolveAccountSection,
  resolveActiveAccountSection,
  resolveLegacyAccountTab,
} from './account-sections.config';

describe('account sections config', () => {
  it('lists the seven sections in display order', () => {
    expect(ACCOUNT_SECTIONS.map(def => def.id)).toEqual([
      'account',
      'notifications',
      'appearance',
      'activity',
      'security',
      'data',
      'danger',
    ]);
    expect(ACCOUNT_SECTIONS.map(def => def.id)).toEqual([
      ...ACCOUNT_SECTION_IDS,
    ]);
  });

  it('marks only the danger section with the danger tone', () => {
    expect(
      ACCOUNT_SECTIONS.filter(def => def.tone === 'danger').map(def => def.id)
    ).toEqual(['danger']);
  });

  it('gives every section its own label and description key', () => {
    const labels = new Set(ACCOUNT_SECTIONS.map(def => def.labelKey));
    const descriptions = new Set(
      ACCOUNT_SECTIONS.map(def => def.descriptionKey)
    );
    expect(labels.size).toBe(ACCOUNT_SECTIONS.length);
    expect(descriptions.size).toBe(ACCOUNT_SECTIONS.length);
    for (const def of ACCOUNT_SECTIONS) {
      expect(def.descriptionKey).toBe(`${def.labelKey}Desc`);
      expect(getAccountSectionDef(def.id)).toBe(def);
    }
  });
});

describe('resolveAccountSection', () => {
  it('accepts a known id, also as the first of an array', () => {
    expect(resolveAccountSection('security')).toBe('security');
    expect(resolveAccountSection(['data', 'danger'])).toBe('data');
  });

  it('rejects a missing, unknown or legacy value', () => {
    expect(resolveAccountSection(undefined)).toBeNull();
    expect(resolveAccountSection('')).toBeNull();
    expect(resolveAccountSection('pay')).toBeNull();
    expect(resolveAccountSection('konto')).toBeNull();
    expect(resolveAccountSection('toString')).toBeNull();
  });
});

describe('resolveLegacyAccountTab', () => {
  it('maps the two renamed tabs', () => {
    expect(resolveLegacyAccountTab('konto')).toBe('account');
    expect(resolveLegacyAccountTab('preferences')).toBe('notifications');
  });

  it('keeps the tabs whose id did not change', () => {
    for (const id of [
      'appearance',
      'activity',
      'security',
      'data',
      'danger',
    ] as const) {
      expect(resolveLegacyAccountTab(id)).toBe(id);
    }
    expect(resolveLegacyAccountTab(['activity', 'data'])).toBe('activity');
  });

  it('ignores a missing or unknown value, so nothing redirects', () => {
    expect(resolveLegacyAccountTab(undefined)).toBeNull();
    expect(resolveLegacyAccountTab('billing')).toBeNull();
    expect(resolveLegacyAccountTab('notifications')).toBeNull();
    expect(resolveLegacyAccountTab('constructor')).toBeNull();
  });
});

describe('buildAccountSectionHref', () => {
  it('builds the section route and never collides with payments', () => {
    expect(buildAccountSectionHref('activity')).toBe(
      `${ROUTES_FRONT.USER_ACCOUNT}/activity`
    );
    for (const id of ACCOUNT_SECTION_IDS) {
      expect(buildAccountSectionHref(id)).not.toBe(
        ROUTES_FRONT.USER_ACCOUNT_PAY
      );
    }
  });

  it('a legacy redirect target carries no tab parameter (no loop)', () => {
    expect(buildAccountSectionHref('notifications')).not.toContain('tab=');
  });
});

describe('resolveActiveAccountSection', () => {
  it('reads the default section on the bare account route', () => {
    expect(
      resolveActiveAccountSection(ROUTES_FRONT.USER_ACCOUNT, undefined)
    ).toBe('account');
  });

  it('reads the section from the route param on a section route', () => {
    expect(
      resolveActiveAccountSection(ROUTES_FRONT.USER_ACCOUNT_SECTION, 'danger')
    ).toBe('danger');
    expect(
      resolveActiveAccountSection(ROUTES_FRONT.USER_ACCOUNT_SECTION, 'nope')
    ).toBeNull();
  });

  it('marks nothing outside the account settings routes', () => {
    expect(
      resolveActiveAccountSection(ROUTES_FRONT.USER_ACCOUNT_PAY, undefined)
    ).toBeNull();
    expect(
      resolveActiveAccountSection(ROUTES_FRONT.SUPPORT, 'account')
    ).toBeNull();
  });
});
