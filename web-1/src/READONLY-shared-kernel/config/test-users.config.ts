export const TEST_USERS_CONFIG = {
  STYLIST: {
    email: 'test-stylist-main@example.com',
    role: 'STYLIST_ROLE' as const,
    display_name: 'Test Stylist',
    pricing_plan: 'FREE' as const,
  },
  CLIENT: {
    email: 'test-client-main@example.com',
    role: 'CLIENT_ROLE' as const,
  },
  // DECISION: the test admin is seeded as MASTER_ADMIN regardless of the MASTER_ADMIN_EMAIL env var,
  // so quick-login (DEV/STAGING) has a stable admin without anyone adding an email to the
  // allow-list. The example.com domain (RFC 2606) cannot collide with a real user.
  ADMIN: {
    email: 'test-admin-main@example.com',
    role: 'MASTER_ADMIN' as const,
    display_name: 'Test Admin',
  },
  // DECISION: DEMO accounts are separate from the smoke trio above. Smoke runs pre-clean
  // (tests/smoke/_setup.ts: delete the test stylist's whole gallery, revoke her pairs), so content on
  // smoke accounts would not survive. The demo duo is a permanent showcase seeded by
  // seedDemoContent_IO for manual clicking and visual QA; smoke tests never touch it.
  DEMO_STYLIST: {
    email: 'demo-stylist-main@example.com',
    role: 'STYLIST_ROLE' as const,
    display_name: 'Ania Wiśniewska',
    // STUDIO (owner): demo = wystawa PEŁNI produktu — na PRO
    // branding był maskowany, a salon-staff zamknięty; przy testach pricingu
    // owner i tak przełącza plany ręcznie.
    pricing_plan: 'STUDIO' as const,
  },
  DEMO_CLIENT: {
    email: 'demo-client-main@example.com',
    role: 'CLIENT_ROLE' as const,
    display_name: 'Karolina Mazur',
  },
  // DECISION: two extra showcase stylists beside Ania so "Odkrywaj" and the public profile list do not
  // show one person. Same regime as DEMO_STYLIST (permanent seed, never touched by smoke tests); the
  // rest of the showcase (salon staff, clients) lives only in demo-content-seeding.*.
  DEMO_STYLIST_OLA: {
    email: 'demo-stylist-ola@example.com',
    role: 'STYLIST_ROLE' as const,
    display_name: 'Ola Kaczmarek',
    pricing_plan: 'PRO' as const,
  },
  DEMO_STYLIST_NINA: {
    email: 'demo-stylist-nina@example.com',
    role: 'STYLIST_ROLE' as const,
    display_name: 'Nina Borkowska',
    pricing_plan: 'PRO_PLUS' as const,
  },
} as const;
