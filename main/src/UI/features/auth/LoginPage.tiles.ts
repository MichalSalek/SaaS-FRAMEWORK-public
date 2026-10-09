// LoginPage.tiles.ts — Quick Login tile model + data.
// Extracted from LoginPage.tsx (FDX FAZA 3 / W3.5) so both the page and the
// useLoginFlows hook can share the QuickLoginTile type without a circular
// import. Tiles are visible in DEVELOPMENT only (devLogin_IO).
//
// Backend gate `/api/auth/dev-login` requires NODE_ENV_MANUAL=DEVELOPMENT.
// STAGING/PREVIEW/PRODUCTION zwracaja respondForbidden (defense-in-depth).

import { TEST_USERS_CONFIG } from '@kernel/config/test-users.config';

export interface QuickLoginTile {
  label: string;
  sublabel: string;
  email: string;
  /** Visual variant — 'admin' uses ShieldCheckIcon + warning-tinted full-row card. */
  variant?: 'user' | 'admin';
}

export const QUICK_LOGIN_TILES: QuickLoginTile[] = [
  {
    label: 'Test Stylist',
    sublabel: 'Stylistka (FREE)',
    email: TEST_USERS_CONFIG.STYLIST.email,
  },
  {
    label: 'Test Client',
    sublabel: 'Klientka (FREE)',
    email: TEST_USERS_CONFIG.CLIENT.email,
  },
  // Demo-duo: konta z trwalym contentem (galeria, para, sesje, ulubione) —
  // smoke testy ich NIE czyszcza (w przeciwienstwie do smoke-trio powyzej).
  // Seed: web-1 demo-content-seeding.operations.ts (DEVELOPMENT-only).
  {
    label: 'Demo Stylist',
    sublabel: 'Stylistka (Studio, z galerią)',
    email: TEST_USERS_CONFIG.DEMO_STYLIST.email,
  },
  {
    label: 'Demo Client',
    sublabel: 'Klientka (sparowana)',
    email: TEST_USERS_CONFIG.DEMO_CLIENT.email,
  },
  // DECISION (nie usuwaj tego komentarza):
  // Test Admin tile (DEVELOPMENT only via isDev gate — IS_DEVELOPMENT_ENV()
  // checks NEXT_PUBLIC_NODE_ENV_MANUAL === 'DEVELOPMENT'). Enables Playwright
  // design sessions + admin QA without manual magic-link flow. Backend route
  // guard (MASTER_ADMIN check) still applies — this just provides a one-click
  // path to an already-seeded admin session.
  {
    label: 'Test Admin',
    sublabel: 'Administrator',
    email: TEST_USERS_CONFIG.ADMIN.email,
    variant: 'admin',
  },
];
