// LoginPage.tiles.ts — Quick Login tile model + data.
// Extracted from LoginPage.tsx so both the page and the useLoginFlows hook can share the
// QuickLoginTile type without a circular import. Tiles are visible in DEVELOPMENT only
// (devLogin_IO).
//
// Backend gate `/api/auth/dev-login` requires NODE_ENV_MANUAL=DEVELOPMENT.
// STAGING/PREVIEW/PRODUCTION return respondForbidden (defense-in-depth).

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
  // Demo duo: accounts with persistent content (gallery, pair, sessions, favourites) — smoke tests
  // do NOT clean them (unlike the smoke trio above).
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
  // Dev-only tile (isDev gate): a one-click seeded admin session for QA and design sessions; the
  // backend MASTER_ADMIN guard still applies.
  {
    label: 'Test Admin',
    sublabel: 'Administrator',
    email: TEST_USERS_CONFIG.ADMIN.email,
    variant: 'admin',
  },
];
