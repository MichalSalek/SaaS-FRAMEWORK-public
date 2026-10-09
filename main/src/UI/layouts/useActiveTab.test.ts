import { describe, it, expect } from 'vitest';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { isTabLit, resolveActiveTabPath } from './useActiveTab';

// resolveActiveTabPath is the pure longest-known-prefix matcher behind the
// active bottom tab. Two invariants matter and are easy to regress:
//   1. ROUTES_FRONT.APP ('/app') matches ONLY exactly — never as a prefix.
//   2. Among real prefixes, the LONGEST candidate wins.

const STYLIST_PATHS = [
  ROUTES_FRONT.APP,
  ROUTES_FRONT.GALLERY,
  ROUTES_FRONT.PAIRING,
  ROUTES_FRONT.GALLERY_UPLOAD_ASSET,
];

describe('resolveActiveTabPath', () => {
  it('matches the Dashboard tab (/app) only on the exact route', () => {
    expect(resolveActiveTabPath(STYLIST_PATHS, ROUTES_FRONT.APP)).toBe(
      ROUTES_FRONT.APP
    );
  });

  it('does NOT light Dashboard on a deeper /app/* route (exact-only APP)', () => {
    // A pushed screen with no own tab → no tab active (stack-push semantics).
    expect(resolveActiveTabPath(STYLIST_PATHS, '/app/account')).toBe('');
  });

  it('matches a non-APP tab exactly', () => {
    expect(resolveActiveTabPath(STYLIST_PATHS, ROUTES_FRONT.GALLERY)).toBe(
      ROUTES_FRONT.GALLERY
    );
  });

  it('matches a non-APP tab by prefix on its sub-routes', () => {
    expect(
      resolveActiveTabPath(STYLIST_PATHS, ROUTES_FRONT.GALLERY + '/123')
    ).toBe(ROUTES_FRONT.GALLERY);
  });

  it('prefers the LONGEST prefix when two candidates both match', () => {
    // /app/gallery/upload-asset must NOT be flagged as the /app/gallery tab.
    expect(
      resolveActiveTabPath(
        STYLIST_PATHS,
        ROUTES_FRONT.GALLERY_UPLOAD_ASSET + '/step'
      )
    ).toBe(ROUTES_FRONT.GALLERY_UPLOAD_ASSET);
  });

  it('returns empty string when nothing matches', () => {
    expect(resolveActiveTabPath(STYLIST_PATHS, '/totally/other')).toBe('');
  });

  it('ignores empty candidate paths (drawer-toggle tabs without a path)', () => {
    expect(resolveActiveTabPath(['', ROUTES_FRONT.GALLERY], '/x')).toBe('');
  });
});

// isTabLit decides which tab carries the indicator. The place indicator is
// never empty: a screen outside every tab lights „Więcej” (the menu it lives
// in), and an open menu takes the indicator over.
describe('isTabLit', () => {
  const gallery = { path: ROUTES_FRONT.GALLERY };
  const more = { isDrawerToggle: true };

  it('lights the tab whose path is the active one', () => {
    expect(isTabLit(gallery, ROUTES_FRONT.GALLERY, false)).toBe(true);
    expect(isTabLit(more, ROUTES_FRONT.GALLERY, false)).toBe(false);
  });

  it('lights „Więcej” on a screen that belongs to no tab', () => {
    expect(isTabLit(more, '', false)).toBe(true);
    expect(isTabLit(gallery, '', false)).toBe(false);
  });

  it('gives the indicator to „Więcej” while the menu is open', () => {
    expect(isTabLit(more, ROUTES_FRONT.GALLERY, true)).toBe(true);
    expect(isTabLit(gallery, ROUTES_FRONT.GALLERY, true)).toBe(false);
  });

  it('never lights a placeholder slot', () => {
    expect(isTabLit({}, '', false)).toBe(false);
  });
});
