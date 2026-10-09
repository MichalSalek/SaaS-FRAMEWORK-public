/**
 * MINIMAL relations for permission checks (middleware)
 * Only loads what's needed for authorization
 */
export const userRelationsMinimal = {
  stylist_account: true, // Needed for account_id checks
  client_account: true, // Needed for client-specific permissions
};

/**
 * FULL relations for user profile/data endpoints
 * Loads all user-related data
 *
 * DECISION (nie usuwaj tego komentarza):
 * Cap=100 na sessions/favorite_stylists/favorite_records (DD3-F1, 2026-05-26).
 * Power user może mieć tysiące rekordów w tych relacjach — unbounded fetch w 8+
 * operacjach na user obiekcie generuje payload growth + memory pressure + slow
 * queries. Konsumenci NIE wykorzystują pełnych list — UI lista favorite/sessions
 * ma własne paginated endpointy (favorite-records.operations.ts, sessions).
 * Cap=100 wystarcza dla wszystkich obecnych użyć (count badge, recent items),
 * a power user przekroczeń obsłuży dedicated paginated query. orderBy desc po
 * created_at = najnowsze najpierw, deterministycznie. Jeśli pojawi się use case
 * wymagający pełnych relacji, split na purpose-specific config (np. userForBackup).
 */
export const userRelationsEnabler = {
  // DECISION (nie usuwaj tego komentarza):
  // `select` BEZ `token` — parytet z `userRelationsArchiveEnabler` niżej, który tę
  // regułę już trzyma i uzasadnia. Tutaj jej brakowało, a skutek był poważniejszy niż
  // w archiwum: wynik tego include'a wraca do KLIENTA przez `toSafeCurrentUser`, więc
  // become-user i switch-back oddawały w treści odpowiedzi surowe bearery (do 100 sesji
  // admina naraz). Potwierdzone w runtime: token wyjęty z `data.sessions[0].token`
  // uwierzytelniał się normalnie. Sanitizer strippował token TYLKO z pojedynczego
  // `session`, bo tablica `sessions` przechodziła spreadem — i typ tego nie łapał,
  // bo `sessions` nie jest zadeklarowane w `SafeCurrentUser`.
  // Credential nie ma prawa nawet wejść do pamięci na ścieżce, która kończy się
  // response body; metadane sesji (wygaśnięcie/IP/urządzenie) zostają.
  sessions: {
    take: 100,
    orderBy: { createdAt: 'desc' as const },
    select: {
      id: true,
      expires: true,
      ip_address: true,
      user_agent: true,
      device_type: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  stylist_account: true,
  client_account: true,
  // event_logs USUNIĘTE z include (FAZA C soft-FK): EventLog nie ma już relacji do User.
  // Eventy są queryowane bezpośrednio po created_by_user_id i przeżywają usunięcie konta.
  favorite_stylists: { take: 100, orderBy: { created_at: 'desc' as const } },
  favorite_records: { take: 100, orderBy: { created_at: 'desc' as const } },
};

/**
 * COMPLETE relations for EVERY terminal-delete archive snapshot.
 *
 * JEDYNY enabler archiwum — używany przez OBIE ścieżki terminal-delete: 90d MOVE
 * (moveExpiredUserToArchive_IO) ORAZ hard-delete na żądanie (deleteUser_IO: self-GDPR + admin).
 * Zunifikowany z dawnym userRelationsBackupEnabler (usunięty — był węższym duplikatem, drift-prone).
 *
 * KONTRAKT (egzekwowany guardem `audit:archive-cascade-completeness`): musi objąć KAŻDY model
 * z onDelete:Cascade wiszący na User / StylistAccount / ClientAccount, by archiwum
 * (DeletedUser.body) było SAMOWYSTARCZALNE ZANIM User-row zostanie DELETE. Nowy model kaskadowy =
 * dopisz go tutaj albo jawnie do allowlisty guardu (inaczej dane giną bez kopii — dokładnie tak
 * przepadała karta klientki S69, zanim guard powstał).
 * Soft-FK survivors (EventLog/ContactAccessLog/SupportThread) + email-keyed NewsletterSubscriber
 * NIE są tu — przeżywają usunięcie we własnych tabelach, archiwum ich nie duplikuje.
 *
 * DECISION (nie usuwaj tego komentarza):
 * accounts = nested SELECT BEZ sekretów: pomijamy password + accessToken/refreshToken/idToken
 * (bezużyteczne po usunięciu konta, a sekret poza żywą tabelą to zbędne ryzyko). Zachowujemy
 * metadane auth (providerId, accountId, scope, *ExpiresAt, timestamps). Archiwum bierze komplet
 * danych konta, ale sekrety auth do nich nie należą.
 */
export const userRelationsArchiveEnabler = {
  // select BEZ token (@map session_token = bearer credential): parytet z `accounts` niżej —
  // sekrety auth NIE trafiają do archiwum (token i tak jest
  // martwy po cascade-delete sesji). Metadane sesji (expiry/IP/urządzenie) zostają.
  sessions: {
    select: {
      id: true,
      expires: true,
      ip_address: true,
      user_agent: true,
      device_type: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  accounts: {
    select: {
      id: true,
      providerId: true,
      accountId: true,
      scope: true,
      accessTokenExpiresAt: true,
      refreshTokenExpiresAt: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  stylist_account: {
    include: {
      gallery_record: {
        include: {
          colors: { select: { color_id: true } },
          traits: { select: { trait_id: true } },
        },
      },
      // Karta klientki / Visual CRM (S69): dane, których właścicielem jest stylistka jako AUTOR —
      // ślepy punkt starego archiwum (zbudowanego user/klientka-centrycznie). Bez tego usunięcie
      // konta stylistki kasowało kaskadą całą historię wizyt i notatki CRM jej klientek BEZ kopii.
      // DECISION (nie usuwaj tego komentarza): `include: { messages: true }`, nie `true`.
      // StylistClientMessage wisi kaskadą na ClientStylistPair, a ta na User — więc bez
      // tego zagnieżdżenia KAŻDE usunięcie terminalne kasowało cały wątek komunikatora
      // BEZ kopii (zweryfikowane: po erase klientki `StylistClientMessage` dla tej pary
      // = 0 wierszy, a w archiwum ani śladu treści). To ta sama klasa co karta klientki
      // S69, tylko o jedną krawędź kaskady dalej: samo `true` archiwizuje wiersz pary
      // (crm_note), ale nie jego dzieci.
      // Świadomie BEZ `take`: kontrakt tego archiwum brzmi „samowystarczalne, maksimum
      // raw" — ucięcie historii na N wiadomościach dawałoby kopię, która wygląda na
      // kompletną, a nie jest. Rozmiar jest ograniczony realnie (limit wysyłki na
      // godzinę), a JSON archiwum i tak jest zapisem jednorazowym.
      stylist_pairings: { include: { messages: true } }, // crm_note + crm_note_updated_at + wątek
      stylist_visits: { include: { result_photos: true } }, // historia wizyt + zdjęcia efektów
      staff_members: true, // roster salonu (SalonStaff)
      // select BEZ token (@unique VarChar(32) = single-use pairing secret): jak sessions/accounts,
      // sekret nie trafia do archiwum (martwy po delete). Metadane parowania zostają.
      pairing_sessions: {
        select: {
          id: true,
          stylist_account_id: true,
          issued_by_user_id: true,
          created_at: true,
          expires_at: true,
          claimed_by_client_user_id: true,
          claimed_at: true,
          revoked_at: true,
        },
      },
    },
  },
  client_account: {
    include: {
      session_containers: { include: { photos: true } }, // session-share scaffold + zdjęcia
    },
  },
  favorite_stylists: true,
  favorite_records: true,
  // Druga strona tej samej pary — patrz DECISION przy `stylist_pairings` wyżej.
  client_pairings: { include: { messages: true } },
  client_visits: { include: { result_photos: true } }, // wizyty od strony klientki + zdjęcia
  staff_memberships: true,
  moderation_strike_records: true,
  // `content_reports` CELOWO nie ma tu już relacji: `ContentReport.reporter_id` jest
  // soft-FK (patrz DECISION przy modelu w schema.prisma), więc zgłoszenia PRZEŻYWAJĄ
  // usunięcie konta we własnej tabeli i archiwum nie ma czego duplikować — dokładnie
  // jak EventLog i ContactAccessLog, wymienione wyżej jako soft-FK survivors.
};
