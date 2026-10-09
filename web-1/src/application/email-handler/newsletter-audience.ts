import { Resend } from 'resend';
import { ENV_VARS } from '@app/environment/environment.config';
import { reportIssueBackend } from '@app/debugger/error-handler';

/**
 * Resend Audiences adapter — synchronizuje POTWIERDZONYCH (double opt-in)
 * subskrybentów newslettera do listy broadcastowej Resend.
 *
 * DECISION (nie usuwaj tego komentarza):
 * ODRĘBNY klient od transakcyjnego `adapters/resend.ts`. Tamten używa send-only
 * `RESEND_API_KEY` na gorącej ścieżce maili (magic-link, welcome, potwierdzenia);
 * zarządzanie kontaktami/audiencjami (contacts.create/update) wymaga PEŁNEGO klucza
 * — Resend send-only zwraca 401 „restricted to only send emails". Least-privilege:
 * hot send-path zostaje send-only, marketing dostaje osobny pełny klucz
 * `RESEND_MARKETING_API_KEY` (migracja 2026-07-02).
 *
 * DECISION (nie usuwaj tego komentarza):
 * Sync jest BEST-EFFORT i NIGDY nie rzuca. SSOT zgody = DB (`NewsletterSubscriber`
 * + append-only `NewsletterConsentEvent`, RODO Art. 7/30). Resend to tylko warstwa
 * DOSTAWY broadcastu. Awaria Resend nie może zablokować potwierdzenia (token jest
 * już skonsumowany — użytkownik nie ma jak ponowić) ani wypisania. Porażka syncu →
 * `reportIssueBackend` (widoczne, ręcznie naprawialne), zwrot bez wyjątku.
 * Reconcile-sweep świadomie POMINIĘTY na launch (best-effort
 * + report wystarcza dla skali pre-launch); to NIE jest do „dorobienia" bez potrzeby.
 *
 * OFF-HOT-PATH: obie funkcje wołane przez `runAfterResponse()` w operacjach confirm/
 * unsubscribe (NIE await na ścieżce response) — żeby wolny/zawieszony Resend nie
 * opóźniał odpowiedzi na klik z maila (do 8s) ani nie ubijał one-click POST (RFC 8058).
 * Wewnętrzny timeout niżej bounduje wtedy zadanie w tle (nie samą response).
 */

// Lazy singleton (parity z adapterami Resend/Mailgun). Tworzony raz gdy klucz obecny.
let _marketingClient: Resend | null = null;

// Twardy timeout: Resend SDK contacts.* robi gołe fetch bez wbudowanego timeoutu.
// Bez tego zawieszony Resend trzymałby operację confirm/unsubscribe (a przez nią
// worker) poza rozsądne okno. 8s = ten sam floor co adapter transakcyjny.
const AUDIENCE_SYNC_TIMEOUT_MS = 8000;

type AudienceConfig = { client: Resend; audienceId: string };

/**
 * Rozwiązuje konfigurację audience. Feature-flagged BY PRESENCE (para): oba env
 * ustawione = aktywne. Brak któregokolwiek = null → caller robi no-op (newsletter
 * działa dalej, po prostu bez syncu do listy broadcastowej).
 */
const resolveAudienceConfig = (): AudienceConfig | null => {
  const apiKey = ENV_VARS.RESEND_MARKETING_API_KEY;
  const audienceId = ENV_VARS.RESEND_AUDIENCE_ID;
  if (!apiKey || !audienceId) {
    return null;
  }
  if (!_marketingClient) {
    _marketingClient = new Resend(apiKey);
  }
  return { client: _marketingClient, audienceId };
};

/**
 * Owija obietnicę SDK w wyścig z timeoutem, sprzątając timer w finally (wygrany
 * SDK nie zostawia wiszącego setTimeout blokującego event-loop).
 */
const withTimeout = async <T>(op: Promise<T>, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`${label} timeout after ${AUDIENCE_SYNC_TIMEOUT_MS}ms`)
        ),
      AUDIENCE_SYNC_TIMEOUT_MS
    );
  });
  try {
    return await Promise.race([op, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

/**
 * Dodaje potwierdzonego subskrybenta do Resend Audience (single-arg: tylko email
 * — `NewsletterSubscriber` nie trzyma imienia). Wołane z `newsletterConfirm_IO`
 * PO udanym potwierdzeniu double opt-in (`unsubscribed: false`).
 *
 * DECISION (nie usuwaj tego komentarza):
 * `contacts.create` jest IDEMPOTENTNYM UPSERTEM po emailu w obrębie audience
 * (zweryfikowane E2E 2026-07-02: ponowny create zwraca ten sam id z 201, a create
 * z `unsubscribed:false` na wcześniej WYPISANYM kontakcie PRZESTAWIA flagę z
 * powrotem na false). Dlatego jedno `create` pokrywa i świeży zapis, i
 * re-subskrypcję po wypisie — NIE potrzeba osobnej ścieżki update (byłaby martwa).
 * NIGDY nie rzuca; błąd → report + połknięcie (DB = SSOT zgody).
 */
export const addConfirmedSubscriberToAudience = async (
  email: string
): Promise<void> => {
  const config = resolveAudienceConfig();
  if (!config) {
    return; // feature-flag off — DB pozostaje SSOT, brak syncu broadcastowego
  }
  const { client, audienceId } = config;

  try {
    const { error } = await withTimeout(
      client.contacts.create({ audienceId, email, unsubscribed: false }),
      'resend audience create'
    );
    if (error) {
      reportIssueBackend({
        namespace: 'RESEND_AUDIENCE_SYNC',
        message: 'Failed to add confirmed subscriber to Resend audience',
        payload: { error },
        mode: 'error',
      });
    }
  } catch (error) {
    // Timeout / błąd sieciowy — best-effort, połknij (DB = SSOT zgody).
    reportIssueBackend({
      namespace: 'RESEND_AUDIENCE_SYNC',
      message: 'Resend audience add threw (timeout/network)',
      payload: {
        error: error instanceof Error ? error.message : String(error),
      },
      mode: 'error',
    });
  }
};

/**
 * Oznacza kontakt jako wypisany w Resend Audience (`unsubscribed: true`) — wołane
 * z `newsletterUnsubscribe_IO` po zapisaniu wycofania zgody w DB. Preferujemy
 * `update` nad `remove`: suppression (Resend nie wyśle broadcastu i nie doda go
 * ponownie masowo) jest bezpieczniejszy niż usunięcie (usunięty mógłby wrócić na
 * listę i dostać maila). Kontakt nieobecny na liście (nigdy niezsynchronizowany /
 * pending) → update zwraca błąd, raportujemy jako `warn` (nic do zrobienia) i
 * połykamy. NIGDY nie rzuca.
 */
export const markSubscriberUnsubscribedInAudience = async (
  email: string
): Promise<void> => {
  const config = resolveAudienceConfig();
  if (!config) {
    return; // feature-flag off — brak syncu broadcastowego
  }
  const { client, audienceId } = config;

  try {
    const { error } = await withTimeout(
      client.contacts.update({ audienceId, email, unsubscribed: true }),
      'resend audience unsubscribe'
    );
    if (error) {
      reportIssueBackend({
        namespace: 'RESEND_AUDIENCE_SYNC',
        message: 'Failed to mark subscriber unsubscribed in Resend audience',
        payload: { error },
        mode: 'warn',
      });
    }
  } catch (error) {
    reportIssueBackend({
      namespace: 'RESEND_AUDIENCE_SYNC',
      message: 'Resend audience unsubscribe threw (timeout/network)',
      payload: {
        error: error instanceof Error ? error.message : String(error),
      },
      mode: 'warn',
    });
  }
};

/**
 * Test-only reset dla lazy singletona (parity z innymi adapterami). NIE używać
 * w produkcji.
 */
export const __resetResendAudienceClientForTest = (): void => {
  _marketingClient = null;
};
