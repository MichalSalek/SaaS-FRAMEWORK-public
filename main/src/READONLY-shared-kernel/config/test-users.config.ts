/**
 * Test Users Configuration - SSOT
 *
 * Używane przez:
 * - Backend seeding (instrumentation.ts)
 * - Smoke tests (tests/config/test.config.ts)
 *
 * Auto-seeded w środowisku DEVELOPMENT podczas startu aplikacji.
 */

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
  // DECISION (nie usuwaj tego komentarza):
  // Test admin seeded jako MASTER_ADMIN niezaleznie od MASTER_ADMIN_EMAIL env var.
  // Powod: chcemy stabilny test admin do quick-login (DEV/STAGING) bez wymogu by
  // ktokolwiek dopisywal swoj email do allow-list. Email lezy w *.example.com domenie
  // (RFC 2606 — gwarantowanie nieosiagalna, brak ryzyka collision z prawdziwym uzytkownikiem).
  ADMIN: {
    email: 'test-admin-main@example.com',
    role: 'MASTER_ADMIN' as const,
    display_name: 'Test Admin',
  },
  // DECISION (nie usuwaj tego komentarza):
  // Konta DEMO sa ODSEPAROWANE od smoke-trio powyzej. Smoke testy przy kazdym runie
  // robia pre-clean (tests/smoke/_setup.ts): kasuja CALA galerie test-stylistki i
  // revokuja jej pary — content na smoke-kontach nie przezyje restartu backendu.
  // Demo-duo to trwala "wystawa" z bogatym contentem (galeria, para, sesje, ulubione)
  // seedowana idempotentnie przez seedDemoContent_IO (demo-content-seeding.operations.ts)
  // do recznego klikania po apce i wizualnego QA (/ui census). Smoke testy NIE znaja
  // tych kont i nigdy ich nie dotykaja.
  DEMO_STYLIST: {
    email: 'demo-stylist-main@example.com',
    role: 'STYLIST_ROLE' as const,
    display_name: 'Ania Wiśniewska',
    // STUDIO (owner 2026-07-12): demo = wystawa PEŁNI produktu — na PRO
    // branding był maskowany, a salon-staff zamknięty; przy testach pricingu
    // owner i tak przełącza plany ręcznie.
    pricing_plan: 'STUDIO' as const,
  },
  DEMO_CLIENT: {
    email: 'demo-client-main@example.com',
    role: 'CLIENT_ROLE' as const,
    display_name: 'Karolina Mazur',
  },
  // DECISION (nie usuwaj tego komentarza):
  // Konta-goscie wystawy (S111, 2026-09-14): dwie DODATKOWE stylistki obok Ani,
  // zeby feed "Odkrywaj" i lista publicznych profili nie pokazywaly jednej osoby.
  // Ten sam rezim co DEMO_STYLIST/DEMO_CLIENT — idempotentny seed, brak dotyku
  // smoke-testow. Reszta wystawy (personel salonu, 7 klientek) zyje WYLACZNIE
  // w demo-content-seeding.* (seed-internal, nie SSOT dla innych konsumentow).
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
