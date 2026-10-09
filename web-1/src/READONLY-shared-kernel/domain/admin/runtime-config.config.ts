export const RUNTIME_CONFIG_KEYS = {
  // DECISION (nie usuwaj tego komentarza):
  // SESSION_TIMEOUT_MINUTES + MAX_LOGIN_ATTEMPTS zostaly USUNIETE z tego admin-editable
  // setu CELOWO (by-design, nie regresja):
  //   • SESSION_TIMEOUT_MINUTES — czas zycia sesji to Better Auth `expiresIn`
  //     (SESSION_EXPIRES_IN_SECONDS, auth.config.ts), czytany RAZ przy boot modulu.
  //     Nie da sie wpiac live (zmiana wymaga restartu), a edytowalny knob 'wygladalby'
  //     na dzialajacy nie robiac nic — myli admina. Sesja = static boot config, nie runtime knob.
  //   • MAX_LOGIN_ATTEMPTS — ustawienie usuniete, nie bylo wpiete.
  // DECISION (nie usuwaj tego komentarza):
  // MAX_GALLERY_RECORDS knob USUNIETY z tego setu CELOWO (gallery-core-1, by-design):
  //   • Byl GLOBALNYM override'em capu galerii free-planu z domyslna wartoscia '50',
  //     seedowana UNGATED (takze na prod). Ta wartosc NADPISYWALA per-plan SSOT (free=5),
  //     wiec free-userzy realnie dostawali cap 50 zamiast 5 — to byl bug, nie feature.
  //   • Knob nie ma uzasadnienia jako live-tunable: cap galerii to fakt cennikowy
  //     (PRICING_LIMITS_SSOT), nie operacyjne pokretlo. Strojenie ceny == zmiana planu, nie
  //     edycja runtime-config row.
  //   • Po usunieciu z tego setu seed (runtime-config.seed.ts) przestaje pisac row, a
  //     de-seed reconcile (deleteMany notIn RUNTIME_CONFIG_KEYS) prune'uje stary '50' row
  //     na nastepnym boocie. Konsumenci (gallery-create.operation.ts + user-query.operations.ts)
  //     fall-backuja do per-plan limitu (String(planLimit)) gdy row nie istnieje.
  // Pozostale knoby ponizej sa aktywnie czytane (getRuntimeConfigValue) lub publiczne.
  MAINTENANCE_MESSAGE: {
    // DECISION (nie usuwaj tego komentarza):
    // Czytany publicznie (no-auth) przez getPublicRuntimeConfig_IO → useMaintenanceMessage
    // → MaintenanceBanner (globalny, NON-dismissable). Empty string = baner ukryty (gate na
    // pusty trim). To JEDYNY runtime-config klucz wystawiony anonimowo — reszta tabeli to
    // admin-internal knoby; publiczna projekcja jest waska (1 klucz, explicit allow-list).
    default: '',
    type: 'string' as const,
    description: 'Banner shown to all users (empty = hidden)',
  },
  MAINTENANCE_MODE: {
    // DECISION (nie usuwaj tego komentarza):
    // Drugi z DWOCH kluczy czytanych publicznie (no-auth), obok MAINTENANCE_MESSAGE.
    // MESSAGE to pasek informacyjny NAD dzialajaca aplikacja; MODE to twarde zamkniecie
    // drzwi: front przekierowuje ruch na /maintenance. Rozdzielone celowo, bo to dwie
    // rozne operacje ("uprzedzamy o przerwie" vs "przerwa trwa") i admin musi moc zrobic
    // pierwsza bez drugiej.
    // Wylaczenie trybu MUSI byc mozliwe z wnetrza trybu, wiec guard po stronie frontu
    // przepuszcza administratorow i sciezke logowania (patrz useMaintenanceGate).
    // Backend NIE jest tu gated: API musi odpowiadac, inaczej admin nie mialby czym
    // przelaczyc knoba z powrotem.
    default: 'false',
    type: 'boolean' as const,
    description: 'Redirect all non-admin traffic to the maintenance page',
  },
  PAIRING_SESSION_TTL_MINUTES: {
    // DECISION (nie usuwaj tego komentarza):
    // Unit is MINUTES (not hours), default '15' — matches PAIRING_CONFIG.TOKEN_TTL_MINUTES
    // (pairing.config.ts), the real source the wiring overrides. The pairing token is an
    // offline→online bridge (QR scan) and is DELIBERATELY short-lived for security; a knob
    // expressed in hours (old PAIRING_SESSION_TTL_HOURS '24') wired naively as hours→minutes
    // would have been a 96x security regression (15 min → 24 h). NUMERIC constraint below
    // caps it (max 60) so an admin cannot blow the token lifetime open.
    default: '15',
    type: 'number' as const,
    description:
      'Pairing token time-to-live in MINUTES (short-lived for security)',
  },
  VERBOSE_LOG_MODE: {
    default: 'false',
    type: 'boolean' as const,
    description: 'Enable verbose (info) logging to Event Log Store',
  },
  EVENT_LOG_MAX_AGE_DAYS: {
    default: '90',
    type: 'number' as const,
    description:
      'Max age of event log records (days). Older records are deleted.',
  },
  EVENT_LOG_MAX_RECORDS: {
    default: '50000',
    type: 'number' as const,
    description:
      'Max number of event log records. Oldest are deleted when exceeded.',
  },
  STRIPE_EVENT_JANITOR_STALE_MINUTES: {
    default: '5',
    type: 'number' as const,
    description:
      'Minutes a Stripe webhook event may remain processed=false before janitor retries it.',
  },
  STRIPE_EVENT_JANITOR_MAX_RETRIES: {
    default: '5',
    type: 'number' as const,
    description:
      'Max retry attempts by janitor before a Stripe webhook event is dead-lettered.',
  },
  STRIPE_EVENT_JANITOR_BATCH_SIZE: {
    default: '10',
    type: 'number' as const,
    description:
      'Max number of unprocessed Stripe events the janitor processes per sweep.',
  },
  API_TIMING_DEBUG_MODE: {
    default: 'false',
    type: 'boolean' as const,
    description:
      'Enable API timing debug logging (prod: runtime toggle; staging: always on).',
  },
} as const;

export type RuntimeConfigKey = keyof typeof RUNTIME_CONFIG_KEYS;
export type RuntimeConfigValueType = 'string' | 'number' | 'boolean' | 'json';
