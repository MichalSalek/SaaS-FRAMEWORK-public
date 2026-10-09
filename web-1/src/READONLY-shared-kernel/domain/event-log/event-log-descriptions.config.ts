/**
 * Event Log Descriptions Config
 * Maps APP_EVENTS.INFO event names to human-readable Polish descriptions.
 * `satisfies Partial<Record<EVENT_INFO_TYPE, string>>` — literówka /
 * stale klucz = błąd kompilacji.
 */
import type { EVENT_INFO_TYPE } from '../commands-and-queries/cqrs.types';

export const EVENT_DESCRIPTIONS_PL = {
  // APPLICATION
  GENERAL_ERROR: 'Błąd ogólny',
  SUCCESS: 'Sukces',
  NOT_FOUND: 'Nie znaleziono',
  VALIDATION_FAILED: 'Walidacja nieudana',
  INTERNET_CONNECTION_PROBLEM: 'Problem z połączeniem internetowym',
  API_REQUEST_TIMING: 'Pomiar czasu żądania API',
  ACCESS_DENIED_INFO: 'Dostęp zabroniony',
  PLAN_LIMIT_REACHED_INFO: 'Osiągnięto limit planu',
  RATE_LIMIT_EXCEEDED_INFO: 'Przekroczono limit żądań',
  ALREADY_PROCESSED: 'Już przetworzone',
  ACTIVE_ANNOUNCEMENTS_FETCHED: 'Pobrano aktywne ogłoszenia',

  // ADMIN
  DEBUG_MODE_ENABLED: 'Tryb debugowania włączony',
  DEBUG_MODE_DISABLED: 'Tryb debugowania wyłączony',
  DEBUG_DB_MODE_ENABLED: 'Tryb debugowania bazy danych włączony',
  DEBUG_DB_MODE_DISABLED: 'Tryb debugowania bazy danych wyłączony',
  USER_BECAME_SOMEONE_ELSE: 'Administrator wcielił się w innego użytkownika',
  USER_SWITCHED_BACK_TO_SELF: 'Administrator wrócił do swojego konta',
  NOTES_FETCHED: 'Pobrano notatki',
  NOTE_SET: 'Notatka zapisana',
  POLICY_SAVED: 'Zapisano politykę',
  POLICY_DELETED: 'Usunięto politykę',
  POLICY_SET_MAIN: 'Ustawiono politykę jako główną',
  CONFIG_UPDATED: 'Zaktualizowano konfigurację runtime',
  ADMIN_PRICING_PLAN_CHANGED: 'Plan cenowy zmieniony przez administratora',
  ADMIN_PERMISSIONS_FETCHED: 'Pobrano uprawnienia',
  ADMIN_PERMISSIONS_UPDATED: 'Zaktualizowano uprawnienia',
  COLOR_CREATED: 'Utworzono kolor',
  COLOR_UPDATED: 'Zaktualizowano kolor',
  COLOR_DELETED: 'Usunięto kolor',
  TRAIT_CREATED: 'Utworzono cechę',
  TRAIT_UPDATED: 'Zaktualizowano cechę',
  TRAIT_DELETED: 'Usunięto cechę',
  INVALID_BACKUP: 'Nieprawidłowa kopia zapasowa',
  IMPERSONATION_REFRESHED: 'Odświeżono wcielenie',
  IMPERSONATION_SENSITIVE_BLOCKED:
    'Wrażliwa operacja zablokowana podczas wcielenia',
  IMPERSONATION_SENSITIVE_OVERRIDE:
    'Wrażliwa operacja podczas wcielenia (override admina)',
  ADMIN_USERS_PAGINATED_FETCHED: 'Pobrano użytkowników (stronicowanie)',
  FEATURE_FLAGS_FETCHED: 'Pobrano flagi funkcji',
  FEATURE_FLAG_TOGGLED: 'Przełączono flagę funkcji',
  CANNOT_TOGGLE_FEATURE_FLAG: 'Nie można przełączyć flagi funkcji',
  ADMIN_METRICS_FETCHED: 'Pobrano metryki',
  ADMIN_HEALTH_FETCHED: 'Pobrano status zdrowia systemu',
  ADMIN_CHECK_ACCESS_HEALTH_FETCHED:
    'Sprawdzono dostępność serwera (health check)',
  AUDIT_TRAIL_FETCHED: 'Pobrano dziennik audytu',
  ADMIN_AI_CRAWLER_STATS_RETURNED: 'Pobrano statystyki crawlerów AI',
  ADMIN_AI_CRAWLER_LIST_RETURNED: 'Pobrano listę zdarzeń crawlerów AI',
  USER_TIMELINE_FETCHED: 'Pobrano oś czasu użytkownika',
  BULK_DISABLE_SUCCESS: 'Masowe dezaktywowanie zakończone sukcesem',
  BULK_ENABLE_SUCCESS: 'Masowe aktywowanie zakończone sukcesem',
  BULK_CHANGE_PLAN_SUCCESS: 'Masowa zmiana planu zakończona sukcesem',
  BULK_LOGOUT_SUCCESS: 'Masowe wylogowanie zakończone sukcesem',
  ANNOUNCEMENTS_FETCHED: 'Pobrano ogłoszenia',
  ANNOUNCEMENT_CREATED: 'Utworzono ogłoszenie',
  ANNOUNCEMENT_UPDATED: 'Zaktualizowano ogłoszenie',
  ANNOUNCEMENT_DELETED: 'Usunięto ogłoszenie',
  REPORT_RESOLVED: 'Zgłoszenie rozwiązane',
  STRIKE_APPLIED: 'Nałożono ostrzeżenie (strike)',

  // USER
  UNAUTHORIZED: 'Brak autoryzacji',
  USER_ALREADY_EXISTS: 'Użytkownik już istnieje',
  USER_NOT_FOUND: 'Nie znaleziono użytkownika',
  USER_CREATED: 'Utworzono użytkownika',
  USER_NAME_CHANGED: 'Zmieniono nazwę użytkownika',
  USER_EMAIL_CHANGED: 'Zmieniono email użytkownika',
  EMAIL_ALREADY_EXISTS: 'Email już istnieje',
  USER_DISABLED: 'Użytkownik dezaktywowany',
  USER_DISABLED_SELF: 'Użytkownik dezaktywował własne konto',
  CANNOT_DISABLE_ACTIVE_SUBSCRIPTION:
    'Nie można dezaktywować konta z aktywną subskrypcją',
  USER_ENABLED: 'Użytkownik aktywowany',
  USER_DELETED: 'Użytkownik usunięty',
  USER_DELETED_SELF: 'Użytkownik usunął własne konto',
  LOGIN_FIRST: 'Najpierw zaloguj się',
  ALREADY_LOGGED: 'Już zalogowany',
  USER_LOGGED_IN: 'Użytkownik zalogowany',
  USER_LOGGED_OUT: 'Użytkownik wylogowany',
  CANNOT_LOGIN: 'Nie można zalogować',
  USER_REGISTERED: 'Użytkownik zarejestrowany',
  DEV_LOGIN_SUCCESS: 'Logowanie deweloperskie zakończone sukcesem',
  DEV_LOGIN_BLOCKED: 'Logowanie deweloperskie zablokowane',
  STYLIST_ACCOUNT_CREATED: 'Utworzono konto stylisty',
  CANNOT_ONBOARD_AS_STYLIST: 'Nie można utworzyć konta stylisty',
  CLIENT_ACCOUNT_CREATED: 'Utworzono konto klienta',
  CANNOT_ONBOARD_AS_CLIENT: 'Nie można utworzyć konta klienta',
  ACCOUNT_STATE_FETCHED: 'Pobrano stan konta',
  USER_ROLE_SWITCHED: 'Zmieniono rolę użytkownika',
  ACCOUNT_RECOVERED: 'Konto odzyskane',
  ACCOUNT_RECOVERY_FAILED: 'Odzyskiwanie konta nieudane',
  RECOVERY_NOT_FOUND: 'Nie znaleziono odzyskiwania',
  RECOVERY_EXPIRED: 'Odzyskiwanie wygasło',
  USER_ACCOUNT_MOVED_TO_ARCHIVE: 'Konto przeniesione do archiwum (90d)',
  PLATFORM_GATE: 'Brama platformy',

  // SESSION
  SESSION_DELETED: 'Sesja usunięta',
  SESSION_DELETED_EXACTLY: 'Sesja usunięta dokładnie',
  CANNOT_DELETE_SESSION: 'Nie można usunąć sesji',
  ALL_SESSIONS_DELETED: 'Wszystkie sesje usunięte',
  SESSION_EXPIRED: 'Sesja wygasła',

  // ACCOUNT
  ACCOUNT_SOFT_DELETED: 'Konto dezaktywowane (soft-delete)',
  ACCOUNT_REACTIVATED: 'Konto reaktywowane',
  ACCOUNT_REACTIVATION_FAILED: 'Reaktywacja konta nieudana',
  ACCOUNT_GDPR_ERASED: 'Konto trwale usunięte (RODO Art. 17)',
  USER_DELETE_REQUESTED: 'Zgłoszono usunięcie konta',
  USER_DELETE_CONFIRMED: 'Usunięcie konta potwierdzone',
  USER_EMAIL_CHANGE_REQUESTED: 'Zgłoszono zmianę adresu email',
  USER_EMAIL_CHANGE_CONFIRMED: 'Zmiana adresu email potwierdzona',
  NOTIFICATION_PREFERENCES_UPDATED: 'Zaktualizowano preferencje powiadomień',
  DASHBOARD_NOTE_SET: 'Notatka dashboardu zaktualizowana',
  USER_DATA_EXPORTED: 'Wyeksportowano dane użytkownika',
  STYLIST_SOCIAL_LINKS_UPDATED: 'Zaktualizowano linki społecznościowe stylisty',
  STRIPE_EMAIL_SYNC_FAILED: 'Błąd synchronizacji emaila ze Stripe',
  STRIPE_CHARGE_DISPUTE_CREATED: 'Utworzono spór dotyczący opłaty Stripe',
  STRIPE_CHARGE_DISPUTE_CLOSED: 'Zamknięto spór dotyczący opłaty Stripe',
  PAYMENT_DONE: 'Płatność wykonana',
  CANNOT_MAKE_PAYMENT: 'Nie można wykonać płatności',
  ACCOUNT_NOT_FOUND: 'Nie znaleziono konta',
  ACCOUNT_CREATED: 'Utworzono konto',
  DISPLAY_NAME_CHANGED: 'Zmieniono nazwę wyświetlaną',
  PRICING_PLAN_CHANGED: 'Plan cenowy zmieniony',
  CANNOT_CHANGE_PRICING_PLAN: 'Nie można zmienić planu cenowego',
  ACCOUNT_LOCATION_SET: 'Ustawiono lokalizację konta',
  STYLISTS_WITH_LOCATION_FETCHED: 'Pobrano stylistów z lokalizacją',
  VANITY_URL_SET: 'Ustawiono niestandardowy URL',
  VANITY_URL_ALREADY_EXISTS: 'Niestandardowy URL już istnieje',
  VANITY_URL_RESERVED: 'Niestandardowy URL zarezerwowany',
  STYLIST_PROFILE_UPDATED: 'Zaktualizowano profil stylisty',
  PUBLIC_PROFILE_FETCHED: 'Pobrano profil publiczny',
  STRIPE_SUBSCRIPTION_UPDATED: 'Subskrypcja Stripe zaktualizowana',
  STRIPE_SUBSCRIPTION_DELETED: 'Subskrypcja Stripe usunięta',
  STRIPE_SUBSCRIPTION_PENDING_UPDATE_DETECTED:
    'Wykryto oczekującą aktualizację subskrypcji Stripe',
  STRIPE_SUBSCRIPTION_SCHEDULE_DETECTED:
    'Wykryto harmonogram subskrypcji Stripe',
  STRIPE_INVOICE_PAYMENT_SUCCEEDED:
    'Płatność faktury Stripe zakończona sukcesem',
  STRIPE_INVOICE_PAYMENT_FAILED: 'Płatność faktury Stripe nieudana',
  STRIPE_TRIAL_WILL_END: 'Okres próbny Stripe kończy się',
  TRIAL_STARTED: 'Okres próbny rozpoczęty',
  TRIAL_NOT_ELIGIBLE: 'Brak uprawnień do okresu próbnego',
  TRIAL_ALREADY_USED: 'Okres próbny już wykorzystany',
  STRIPE_INVOICE_UPCOMING: 'Nadchodząca faktura Stripe',
  STRIPE_PORTAL_SESSION_CREATED: 'Utworzono sesję portalu Stripe',
  STRIPE_SUBSCRIPTION_CANCEL_FAILED:
    'Nie udało się anulować subskrypcji Stripe, wymagana interwencja operatora',

  // CLIENT
  CLIENT_CONTACT_UPDATED: 'Zaktualizowano dane kontaktowe klienta',
  CLIENT_PROFILE_FETCHED: 'Pobrano profil klienta',
  CLIENT_CONTACT_FETCHED: 'Pobrano dane kontaktowe klienta',
  NOT_PAIRED_WITH_CLIENT: 'Nie sparowano z klientem',

  // GALLERY
  ASSET_DELETED_FROM_VENDOR: 'Zasób usunięty od dostawcy',
  ASSET_UPLOADED: 'Zasób przesłany',
  GALLERY_RECORD_CREATED: 'Utworzono rekord galerii',
  CANNOT_CREATE_GALLERY_RECORD: 'Nie można utworzyć rekordu galerii',
  GALLERY_RECORD_UPDATED: 'Zaktualizowano rekord galerii',
  COLORS_FETCHED: 'Pobrano kolory',
  TRAITS_FETCHED: 'Pobrano cechy',
  GALLERY_RECORD_DELETED: 'Usunięto rekord galerii',
  GALLERY_RECORD_FETCHED: 'Pobrano rekord galerii',
  CANNOT_GET_GALLERY_RECORD: 'Nie można pobrać rekordu galerii',
  PUBLIC_GALLERY_RECORDS_FETCHED: 'Pobrano publiczne rekordy galerii',
  GALLERY_RECORD_PINNED: 'Przypięto rekord galerii',
  GALLERY_RECORD_UNPINNED: 'Odpięto rekord galerii',
  GALLERY_RECORD_ALREADY_PINNED: 'Rekord galerii już przypięty',
  GALLERY_RECORD_NOT_PINNED: 'Rekord galerii nie przypięty',
  GALLERY_PIN_LIMIT_REACHED: 'Osiągnięto limit przypiętych rekordów',

  // FAVORITE (bookmark + records)
  STYLIST_BOOKMARKED: 'Dodano stylistkę do zakładek',
  STYLIST_ALREADY_BOOKMARKED: 'Stylistka już jest w zakładkach',
  STYLIST_UNBOOKMARKED: 'Usunięto stylistkę z zakładek',
  BOOKMARKED_STYLISTS_FETCHED: 'Pobrano zakładki stylistek',
  CANNOT_ADD_RECORD_TO_FAVORITES: 'Nie można dodać rekordu do ulubionych',
  RECORD_ALREADY_IN_FAVORITES: 'Rekord już w ulubionych',
  RECORD_REMOVED_FROM_FAVORITES: 'Usunięto rekord z ulubionych',
  FAVORITE_RECORDS_FETCHED: 'Pobrano ulubione rekordy',
  FAVORITE_RECORD_ADDED: 'Dodano ulubiony rekord',
  STYLIST_BOOKMARK_ADDED: 'Dodano stylistkę do zakładek',
  RECORD_NOT_IN_FAVORITES: 'Rekord nie jest w ulubionych',
  STYLIST_NOT_BOOKMARKED: 'Stylistka nie jest w zakładkach',
  FAVORITE_RECORD_NOTE_UPDATED: 'Zaktualizowano notatkę ulubionego rekordu',

  // PAIRING
  PAIRING_SESSION_ISSUED: 'Wydano sesję parowania',
  PAIRING_LIMIT_REACHED: 'Osiągnięto limit parowania',
  TOO_MANY_ACTIVE_SESSIONS: 'Zbyt wiele aktywnych sesji',
  PAIRING_SESSION_CLAIMED: 'Sesja parowania potwierdzona',
  INVALID_PAIRING_TOKEN: 'Nieprawidłowy token parowania',
  PAIRING_TOKEN_ALREADY_CLAIMED: 'Token parowania już potwierdzony',
  PAIRING_TOKEN_EXPIRED: 'Token parowania wygasł',
  PAIRING_TOKEN_REVOKED: 'Token parowania odwołany',
  ALREADY_PAIRED: 'Już sparowano',
  PAIRING_SESSION_REVOKED: 'Sesja parowania odwołana',
  PAIRING_ACCESS_REVOKED: 'Dostęp parowania odwołany',
  PAIRING_NOT_FOUND: 'Nie znaleziono parowania',
  PAIRING_ACCESS_STATUS_FETCHED: 'Pobrano status dostępu parowania',
  PAIRING_PAIRS_FETCHED: 'Pobrano pary',
  PAIR_REQUEST_UNAVAILABLE:
    'Prośba o połączenie niedostępna (maska anty-oracle)',
  ALL_PAIRING_SESSIONS_REVOKED: 'Wszystkie sesje parowania odwołane',

  // DECISION (nie usuwaj tego komentarza):
  // F11 dedup: usunięto stale SESSION_SHARE block (post-PIVOT R8) — eventy nie istnieją
  // w APP_EVENTS, zastąpione przez SESSION_CONTAINER_*.

  // SALON_STAFF
  SALON_STAFF_INVITED: 'Zaproszono pracownika salonu',
  SALON_STAFF_REMOVED: 'Usunięto pracownika salonu',
  SALON_STAFF_PERMISSIONS_UPDATED:
    'Zaktualizowano uprawnienia pracownika salonu',
  SALON_STAFF_FETCHED: 'Pobrano pracowników salonu',
  SALON_STAFF_INVITATIONS_FETCHED: 'Pobrano zaproszenia do zespołu salonu',
  SALON_STAFF_INVITATION_ACCEPTED:
    'Zaakceptowano zaproszenie do zespołu salonu',
  SALON_STAFF_INVITATION_DECLINED: 'Odrzucono zaproszenie do zespołu salonu',
  CANNOT_INVITE_STAFF: 'Nie można zaprosić pracownika',
  STAFF_ALREADY_EXISTS: 'Pracownik już istnieje',

  // CLIENT CRM
  CLIENT_CRM_NOTE_FETCHED: 'Pobrano notatkę CRM klientki',
  CLIENT_CRM_NOTE_UPSERTED: 'Zapisano notatkę CRM klientki',
  CLIENT_CRM_NOTE_DELETED: 'Usunięto notatkę CRM klientki',

  // MESSAGING — ukrycie rozmowy (D2, 2026-09-05)
  MESSAGING_CONVERSATION_HIDDEN: 'Ukryto rozmowę',
  MESSAGING_CONVERSATION_UNHIDDEN: 'Przywrócono rozmowę',

  // VISIT
  CLIENT_VISITS_FETCHED: 'Pobrano wizyty klientki',
  VISIT_CREATED: 'Utworzono wizytę klientki',
  VISIT_NOTE_UPDATED: 'Zaktualizowano notatkę wizyty',
  VISIT_RESULT_PHOTO_ADDED: 'Dodano zdjęcie efektu wizyty',
  VISIT_RESULT_PHOTO_REMOVED: 'Usunięto zdjęcie efektu wizyty',
  VISIT_NOT_FOUND: 'Nie znaleziono wizyty',
  CLIENT_CARD_PLAN_LOCKED: 'Karta klientki zablokowana przez plan',

  // PRICING

  // EMAIL — Dunning & Admin
  EMAIL_DUNNING_D1_INFO_SENT: 'Wysłano email dunning (dzień 1, informacyjny)',
  EMAIL_DUNNING_D7_URGENT_SENT: 'Wysłano email dunning (dzień 7, pilny)',
  EMAIL_DUNNING_D14_FINAL_SENT: 'Wysłano email dunning (dzień 14, ostateczny)',
  EMAIL_DUNNING_AUTO_DOWNGRADE:
    'Automatyczny downgrade konta po 15 dniach nieopłaconej faktury',
  EMAIL_ADMIN_SIGNUP_DIGEST_SENT:
    'Wysłano dzienny digest rejestracji do admina',
  EMAIL_ADMIN_CHURN_ALERT_SENT:
    'Wysłano alert o anulowaniu subskrypcji do admina',
  EMAIL_ADMIN_DOWNGRADE_ALERT_SENT: 'Wysłano alert o obniżeniu planu do admina',
  ALERT_PAIRING_ANOMALY_SENT: 'Wysłano alert o anomalii parowania (spike/drop)',
  ALERT_UPLOAD_ERROR_RATE_SENT:
    'Wysłano alert o wysokim wskaźniku błędów uploadu',
  EMAIL_CIRCUIT_BREAKER_OPEN:
    'Bezpiecznik email otwarto (wysoka liczba błędów)',
  EMAIL_CIRCUIT_BREAKER_WARNING: 'Bezpiecznik email: ostrzeżenie',
  EMAIL_CIRCUIT_BREAKER_BLOCKED: 'Email zablokowany przez bezpiecznik',
  ALERT_IMPERSONATION_VOLUME_SENT: 'Wysłano alert o wolumenie podszywania',
  ALERT_IMPERSONATION_OFF_HOURS_SENT:
    'Wysłano alert o podszywaniu poza godzinami',
  EMAIL_ONBOARDING_INCOMPLETE_24H_SENT:
    'Wysłano email: niekompletny onboarding (24h)',
  EMAIL_RENEWAL_REMINDER_7D_SENT:
    'Wysłano email: przypomnienie o odnowieniu (7d)',
  EMAIL_WINBACK_DELETION_D60_SENT:
    'Wysłano email win-back po usunięciu konta (60d)',
  EMAIL_ACCOUNT_DELETION_RECOVERY_SENT:
    'Wysłano email o możliwości przywrócenia konta (90 dni)',
  EMAIL_ACCOUNT_DELETE_CONFIRM_SENT:
    'Wysłano email z potwierdzeniem usunięcia konta',

  // SESSION_CONTAINER (R8)
  SESSION_CONTAINER_CREATED: 'Utworzono kontener sesji inspiracji',
  SESSION_CONTAINER_PHOTO_ADDED: 'Dodano zdjęcie do kontenera sesji',
  SESSION_CONTAINER_SHARED: 'Udostępniono kontener sesji styliście',
  SESSION_CONTAINER_CLOSED: 'Zamknięto kontener sesji',
  SESSION_CONTAINER_NOTE_UPDATED: 'Zaktualizowano notatkę kontenera sesji',
  SESSION_CONTAINER_FETCHED: 'Pobrano kontener sesji',
  SESSION_CONTAINERS_FETCHED: 'Pobrano kontenery sesji',
  SESSION_CONTAINER_NOT_FOUND: 'Nie znaleziono kontenera sesji',
  SESSION_CONTAINER_NOT_AUTHORIZED: 'Brak uprawnień do kontenera sesji',
  SESSION_CONTAINER_NOT_PAIRED: 'Nie sparowano z daną stylistką',
  SESSION_CONTAINER_MAX_ACTIVE_EXCEEDED: 'Przekroczono limit aktywnych sesji',
  SESSION_CONTAINER_INVALID_STATE: 'Nieprawidłowy stan kontenera sesji',
  SESSION_CONTAINER_EMPTY: 'Kontener sesji jest pusty',
  SESSION_CONTAINER_PHOTO_OWNERSHIP:
    'Zdjęcie nie należy do przypisanej stylistki',

  // SUPPORT — eventy threadów wsparcia użytkownika
  SUPPORT_THREAD_CREATED: 'Utworzono wątek wsparcia',
  SUPPORT_MESSAGE_SENT: 'Wysłano wiadomość w wątku wsparcia',
  SUPPORT_ADMIN_REPLIED: 'Administrator odpowiedział w wątku wsparcia',
  SUPPORT_STATUS_CHANGED: 'Zmieniono status wątku wsparcia',
  SUPPORT_THREADS_FETCHED: 'Pobrano wątki wsparcia',
  SUPPORT_MESSAGES_FETCHED: 'Pobrano wiadomości wątku wsparcia',
  SUPPORT_ADMIN_THREADS_FETCHED: 'Pobrano wszystkie wątki wsparcia (admin)',
  SUPPORT_ADMIN_MESSAGES_FETCHED: 'Pobrano wiadomości wątku wsparcia (admin)',
  SUPPORT_UNREAD_COUNT_FETCHED:
    'Pobrano liczbę wątków wsparcia z nową odpowiedzią',
  SUPPORT_THREAD_MARKED_READ: 'Oznaczono wątek wsparcia jako przeczytany',
  SUPPORT_THREAD_NOT_FOUND: 'Nie znaleziono wątku wsparcia',
  SUPPORT_THREAD_NOT_AUTHORIZED: 'Brak uprawnień do wątku wsparcia',
  SUPPORT_THREAD_CLOSED: 'Wątek wsparcia został zamknięty',
  CONTENT_REPORTED: 'Zgłoszono treść',

  // NEWSLETTER
  NEWSLETTER_PENDING_CONFIRMATION:
    'Wysłano email potwierdzający zapis do newslettera',

  // ACCOUNT & GALLERY — uzupełnione w F10 dedup
  PROFILE_VIEW_INCREMENTED: 'Zwiększono licznik wyświetleń profilu',
  EXPLORE_GALLERY_RECORDS_FETCHED: 'Pobrano rekordy galerii (explore)',
  SITEMAP_PROFILES_FETCHED: 'Pobrano profile do sitemap',
  DASHBOARD_FEED_FETCHED: 'Pobrano feed dashboardu',
} satisfies Partial<Record<EVENT_INFO_TYPE, string>>;

// Widened lookup view: consumers resolve descriptions by free-form event name
// (EventLog.event is a string column), so reads go through a string index.
const EVENT_DESCRIPTIONS_LOOKUP: Partial<Record<string, string>> =
  EVENT_DESCRIPTIONS_PL;

/**
 * Get Polish description for an event name.
 * Returns the event name itself if no description is found.
 */
export const getEventDescription = (eventName: string): string =>
  EVENT_DESCRIPTIONS_LOOKUP[eventName] ?? eventName;
