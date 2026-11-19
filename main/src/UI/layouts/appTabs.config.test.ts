import { describe, it, expect } from 'vitest';
import {
  ADMIN_TABS,
  CLIENT_TABS_BASE,
  STYLIST_TABS,
  UNRESOLVED_TABS,
  getClientTabs,
  getTabsForRole,
  isTabRootPath,
} from './appTabs.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';

describe('getTabsForRole', () => {
  it('returns the stylist tab set for role "stylist"', () => {
    expect(getTabsForRole('stylist', false)).toBe(STYLIST_TABS);
  });

  it('returns the admin tab set for role "admin"', () => {
    expect(getTabsForRole('admin', false)).toBe(ADMIN_TABS);
  });

  it('returns the client base set for role "client" with explore off', () => {
    expect(getTabsForRole('client', false)).toBe(CLIENT_TABS_BASE);
  });

  it('swaps the Sessions tab for Explore when explore is enabled (client)', () => {
    const tabs = getTabsForRole('client', true);
    const keys = tabs.map(t => t.bottomNavKey);
    expect(keys).toContain('explore');
    expect(keys).not.toContain('sessions');
  });
});

describe('getTabsForRole with an unknown role', () => {
  it('never falls back to the client tabs', () => {
    const tabs = getTabsForRole(null, true);
    expect(tabs).toBe(UNRESOLVED_TABS);
    const keys = tabs.map(t => t.bottomNavKey).filter(Boolean);
    expect(keys).toEqual(['dashboard', 'more']);
  });

  it('keeps the five slots both role bars have, so nothing moves later', () => {
    expect(UNRESOLVED_TABS).toHaveLength(STYLIST_TABS.length);
    expect(UNRESOLVED_TABS).toHaveLength(CLIENT_TABS_BASE.length);
    expect(UNRESOLVED_TABS.filter(t => t.placeholder === true)).toHaveLength(3);
  });

  it('shows no back button while the tab set is unknown', () => {
    expect(isTabRootPath(UNRESOLVED_TABS, ROUTES_FRONT.GALLERY)).toBe(true);
    expect(isTabRootPath(UNRESOLVED_TABS, ROUTES_FRONT.USER_ACCOUNT)).toBe(
      true
    );
  });
});

describe('getClientTabs', () => {
  it('keeps Sessions and omits Explore when disabled', () => {
    const keys = getClientTabs(false).map(t => t.bottomNavKey);
    expect(keys).toContain('sessions');
    expect(keys).not.toContain('explore');
  });

  it('replaces exactly the Sessions slot with Explore when enabled (length stable)', () => {
    const off = getClientTabs(false);
    const on = getClientTabs(true);
    expect(on).toHaveLength(off.length);
    const onKeys = on.map(t => t.bottomNavKey);
    expect(onKeys).toContain('explore');
    expect(onKeys).not.toContain('sessions');
    // Only the sessions→explore slot changed; every other tab is untouched.
    expect(on.filter(t => t.bottomNavKey !== 'explore')).toEqual(
      off.filter(t => t.bottomNavKey !== 'sessions')
    );
  });
});

describe('isTabRootPath', () => {
  it('treats /app as a root for every role, the admin tab set included', () => {
    expect(isTabRootPath(STYLIST_TABS, ROUTES_FRONT.APP)).toBe(true);
    expect(isTabRootPath(getClientTabs(true), ROUTES_FRONT.APP)).toBe(true);
    expect(isTabRootPath(ADMIN_TABS, ROUTES_FRONT.APP)).toBe(true);
  });

  it("treats each of the role's tab destinations as a root", () => {
    for (const path of [
      ROUTES_FRONT.GALLERY,
      ROUTES_FRONT.PAIRING,
      ROUTES_FRONT.GALLERY_UPLOAD_ASSET,
    ]) {
      expect(isTabRootPath(STYLIST_TABS, path)).toBe(true);
    }
    for (const path of [
      ROUTES_FRONT.EXPLORE,
      ROUTES_FRONT.FAVORITES,
      ROUTES_FRONT.PAIRING,
    ]) {
      expect(isTabRootPath(getClientTabs(true), path)).toBe(true);
    }
  });

  it('follows the live tab set: Sessions is a root only while it is a tab', () => {
    expect(
      isTabRootPath(getClientTabs(false), ROUTES_FRONT.CLIENT_SESSIONS)
    ).toBe(true);
    expect(
      isTabRootPath(getClientTabs(true), ROUTES_FRONT.CLIENT_SESSIONS)
    ).toBe(false);
  });

  it("is role-scoped: another role's tab is a pushed screen", () => {
    // Explore is a client tab; a stylist reaches it from the drawer.
    expect(isTabRootPath(STYLIST_TABS, ROUTES_FRONT.EXPLORE)).toBe(false);
    expect(isTabRootPath(getClientTabs(true), ROUTES_FRONT.GALLERY)).toBe(
      false
    );
  });

  it('matches exactly: a screen below a tab keeps its back button', () => {
    expect(isTabRootPath(STYLIST_TABS, ROUTES_FRONT.STYLIST_GALLERY)).toBe(
      false
    );
    expect(isTabRootPath(STYLIST_TABS, ROUTES_FRONT.USER_ACCOUNT)).toBe(false);
  });
});
