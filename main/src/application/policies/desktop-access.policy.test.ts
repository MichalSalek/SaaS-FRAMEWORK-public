import { describe, it, expect } from 'vitest';
import {
  resolveDesktopAccess,
  DESKTOP_FRAME_MIN_WIDTH,
} from './desktop-access.policy';
import type { DesktopAccessContext } from './desktop-access.policy';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Baseline "desktop PRODUCTION plain user" — triggers redirect by default. */
const BASE_DESKTOP_PROD: DesktopAccessContext = {
  viewportWidth: DESKTOP_FRAME_MIN_WIDTH,
  manualEnv: 'PRODUCTION',
  isAdmin: false,
  isBecomeUser: false,
  isDevMode: false,
};

/** Narrow helper — spread BASE and override only given keys. */
function ctx(overrides: Partial<DesktopAccessContext>): DesktopAccessContext {
  return { ...BASE_DESKTOP_PROD, ...overrides };
}

// ---------------------------------------------------------------------------
// Rule 1 — viewport < DESKTOP_FRAME_MIN_WIDTH → 'normal'
// ---------------------------------------------------------------------------

describe('Rule 1 — viewport < 1280 → normal (no frame, any env/role)', () => {
  it('returns normal when width is exactly 1279 in PRODUCTION, plain user', () => {
    expect(
      resolveDesktopAccess(ctx({ viewportWidth: DESKTOP_FRAME_MIN_WIDTH - 1 }))
    ).toBe('normal');
  });

  it('returns normal when width is 0 (degenerate)', () => {
    expect(resolveDesktopAccess(ctx({ viewportWidth: 0 }))).toBe('normal');
  });

  it('returns normal for width 800 (tablet) even in STAGING', () => {
    expect(
      resolveDesktopAccess(ctx({ viewportWidth: 800, manualEnv: 'STAGING' }))
    ).toBe('normal');
  });

  it('returns normal for width 1279 even when admin=true (rule 1 wins over rule 3)', () => {
    expect(
      resolveDesktopAccess(
        ctx({ viewportWidth: DESKTOP_FRAME_MIN_WIDTH - 1, isAdmin: true })
      )
    ).toBe('normal');
  });

  it('returns normal for width 1279 even when become-user=true (rule 1 wins over rule 4)', () => {
    expect(
      resolveDesktopAccess(
        ctx({
          viewportWidth: DESKTOP_FRAME_MIN_WIDTH - 1,
          isBecomeUser: true,
        })
      )
    ).toBe('normal');
  });

  it('returns normal for width 1279 even in DEVELOPMENT env (rule 1 wins over rule 2)', () => {
    expect(
      resolveDesktopAccess(
        ctx({
          viewportWidth: DESKTOP_FRAME_MIN_WIDTH - 1,
          manualEnv: 'DEVELOPMENT',
        })
      )
    ).toBe('normal');
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — DEVELOPMENT | STAGING → 'frame'
// ---------------------------------------------------------------------------

describe('Rule 2 — DEVELOPMENT / STAGING env at desktop width → frame', () => {
  it('returns frame in DEVELOPMENT', () => {
    expect(resolveDesktopAccess(ctx({ manualEnv: 'DEVELOPMENT' }))).toBe(
      'frame'
    );
  });

  it('returns frame in STAGING', () => {
    expect(resolveDesktopAccess(ctx({ manualEnv: 'STAGING' }))).toBe('frame');
  });

  it('does NOT return frame in PREVIEW (rule 2 does not apply to PREVIEW)', () => {
    // PREVIEW + plain user → redirect (rule 6)
    expect(resolveDesktopAccess(ctx({ manualEnv: 'PREVIEW' }))).toBe(
      'redirect'
    );
  });

  it('does NOT return frame in PRODUCTION via rule 2', () => {
    // PRODUCTION + plain user → redirect (rule 6)
    expect(resolveDesktopAccess(ctx({ manualEnv: 'PRODUCTION' }))).toBe(
      'redirect'
    );
  });

  it('DEVELOPMENT wins even when isAdmin=false, isBecomeUser=false, isDevMode=false', () => {
    expect(
      resolveDesktopAccess(
        ctx({
          manualEnv: 'DEVELOPMENT',
          isAdmin: false,
          isBecomeUser: false,
          isDevMode: false,
        })
      )
    ).toBe('frame');
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — admin role → 'frame'
// ---------------------------------------------------------------------------

describe('Rule 3 — admin=true at desktop width in PRODUCTION/PREVIEW → frame', () => {
  it('returns frame for admin in PRODUCTION', () => {
    expect(resolveDesktopAccess(ctx({ isAdmin: true }))).toBe('frame');
  });

  it('returns frame for admin in PREVIEW', () => {
    expect(
      resolveDesktopAccess(ctx({ isAdmin: true, manualEnv: 'PREVIEW' }))
    ).toBe('frame');
  });

  it('admin on PRODUCTION desktop → frame, NOT redirect (rule 3 before rule 6)', () => {
    const result = resolveDesktopAccess(
      ctx({ isAdmin: true, manualEnv: 'PRODUCTION' })
    );
    expect(result).toBe('frame');
    expect(result).not.toBe('redirect');
  });
});

// ---------------------------------------------------------------------------
// Rule 4 — become-user → 'frame'
// ---------------------------------------------------------------------------

describe('Rule 4 — become-user=true (admin impersonation) → frame', () => {
  it('returns frame when isBecomeUser=true in PRODUCTION', () => {
    expect(resolveDesktopAccess(ctx({ isBecomeUser: true }))).toBe('frame');
  });

  it('returns frame when isBecomeUser=true in PREVIEW', () => {
    expect(
      resolveDesktopAccess(ctx({ isBecomeUser: true, manualEnv: 'PREVIEW' }))
    ).toBe('frame');
  });

  it('become-user on desktop PRODUCTION → frame, NOT redirect (rule 4 before rule 6)', () => {
    const result = resolveDesktopAccess(
      ctx({ isBecomeUser: true, isAdmin: false, isDevMode: false })
    );
    expect(result).toBe('frame');
    expect(result).not.toBe('redirect');
  });
});

// ---------------------------------------------------------------------------
// Rule 5 — devMode → 'frame'
// ---------------------------------------------------------------------------

describe('Rule 5 — isDevMode=true at desktop width in PRODUCTION/PREVIEW → frame', () => {
  it('returns frame when isDevMode=true in PRODUCTION', () => {
    expect(resolveDesktopAccess(ctx({ isDevMode: true }))).toBe('frame');
  });

  it('returns frame when isDevMode=true in PREVIEW', () => {
    expect(
      resolveDesktopAccess(ctx({ isDevMode: true, manualEnv: 'PREVIEW' }))
    ).toBe('frame');
  });

  it('devMode on PRODUCTION desktop → frame, NOT redirect (rule 5 before rule 6)', () => {
    const result = resolveDesktopAccess(
      ctx({ isDevMode: true, isAdmin: false, isBecomeUser: false })
    );
    expect(result).toBe('frame');
    expect(result).not.toBe('redirect');
  });
});

// ---------------------------------------------------------------------------
// Rule 6 — PREVIEW | PRODUCTION + plain user ≥ 1280 → 'redirect'
// ---------------------------------------------------------------------------

describe('Rule 6 — PRODUCTION/PREVIEW + plain user on desktop → redirect', () => {
  it('returns redirect for plain user on PRODUCTION at exactly 1280', () => {
    expect(resolveDesktopAccess(BASE_DESKTOP_PROD)).toBe('redirect');
  });

  it('returns redirect for plain user on PRODUCTION at 1920', () => {
    expect(resolveDesktopAccess(ctx({ viewportWidth: 1920 }))).toBe('redirect');
  });

  it('returns redirect for plain user on PREVIEW at 1280', () => {
    expect(resolveDesktopAccess(ctx({ manualEnv: 'PREVIEW' }))).toBe(
      'redirect'
    );
  });

  it('returns redirect for plain user on PREVIEW at 2560', () => {
    expect(
      resolveDesktopAccess(ctx({ manualEnv: 'PREVIEW', viewportWidth: 2560 }))
    ).toBe('redirect');
  });
});

// ---------------------------------------------------------------------------
// Cascade ordering — first-match-wins edge cases
// ---------------------------------------------------------------------------

describe('Cascade ordering — first-match-wins', () => {
  it('viewport<1280 beats DEVELOPMENT env (rule 1 before rule 2)', () => {
    expect(
      resolveDesktopAccess(
        ctx({ viewportWidth: 1000, manualEnv: 'DEVELOPMENT' })
      )
    ).toBe('normal');
  });

  it('viewport<1280 beats admin flag (rule 1 before rule 3)', () => {
    expect(
      resolveDesktopAccess(ctx({ viewportWidth: 500, isAdmin: true }))
    ).toBe('normal');
  });

  it('viewport<1280 beats devMode (rule 1 before rule 5)', () => {
    expect(
      resolveDesktopAccess(ctx({ viewportWidth: 1279, isDevMode: true }))
    ).toBe('normal');
  });

  it('DEVELOPMENT beats admin flag (rule 2 before rule 3)', () => {
    // Both would yield 'frame', but the ordering matters — rule 2 fires first.
    // We verify that adding admin does not change the result (same branch).
    expect(
      resolveDesktopAccess(ctx({ manualEnv: 'DEVELOPMENT', isAdmin: true }))
    ).toBe('frame');
  });

  it('all override flags false + PRODUCTION + desktop = redirect (baseline sanity)', () => {
    expect(
      resolveDesktopAccess({
        viewportWidth: 1280,
        manualEnv: 'PRODUCTION',
        isAdmin: false,
        isBecomeUser: false,
        isDevMode: false,
      })
    ).toBe('redirect');
  });

  it('boundary: width exactly 1280 is NOT "< 1280" → proceeds to env/role rules', () => {
    // At exactly 1280 (desktop threshold) in PRODUCTION plain user → redirect
    // Confirms the < (strict less-than) boundary in rule 1.
    expect(
      resolveDesktopAccess(ctx({ viewportWidth: DESKTOP_FRAME_MIN_WIDTH }))
    ).toBe('redirect');
  });
});
