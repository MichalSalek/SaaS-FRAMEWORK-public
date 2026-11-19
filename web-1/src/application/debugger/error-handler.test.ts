import { beforeEach, describe, expect, it, vi } from 'vitest';

// Guard of the WIRING, not of the serializer itself (that has its own test).
// Pins a contract whose breakage cost production diagnostics: an AppLogRecord MUST carry the
// failure reason, the request target and the stack, otherwise the entry cannot be reconstructed.

const holder = vi.hoisted(() => ({
  records: [] as Array<Record<string, unknown>>,
  requestTarget: undefined as string | undefined,
  userId: null as string | null,
}));

vi.mock('./error-handler-io', () => ({
  createEventLogRecord_IO: async (record: Record<string, unknown>) => {
    holder.records.push(record);
  },
}));

vi.mock('./posthog-server', () => ({ captureBackendIssue: () => undefined }));

vi.mock('@app/http/request-context', () => ({
  getCurrentCorrelationId: () => 'corr-1',
  getCurrentRequestTarget: () => holder.requestTarget,
  getCurrentRequestReferer: () => undefined,
  getCurrentRequestUserId: () => holder.userId,
}));

vi.mock('@app/environment/environment.utils.api', () => ({
  IS_DEVELOPMENT_ENV: () => false,
  getEnvironmentMode: () => 'PRODUCTION',
}));

const { reportIssueBackend } = await import('./error-handler');

type PersistedRecord = {
  payload: string;
  client_url: string;
  user_metadata: string;
  user_id: string | null;
};

const lastRecord = (): PersistedRecord =>
  holder.records.at(-1) as unknown as PersistedRecord;

describe('reportIssueBackend — rekord musi być diagnozowalny', () => {
  beforeEach(() => {
    holder.records.length = 0;
    holder.requestTarget = 'POST /api/v1/internal/track-crawler';
    holder.userId = null;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('zapisuje komunikat błędu, a nie pusty obiekt', () => {
    reportIssueBackend({
      namespace: 'AI_CRAWLER_TRACK',
      message: 'AiCrawlerEvent insert failed',
      payload: new Error('Connection terminated due to connection timeout'),
      mode: 'error',
    });

    const payload = lastRecord().payload;
    expect(payload).not.toBe('{}');
    expect(payload).toContain(
      'Connection terminated due to connection timeout'
    );
  });

  it('zapisuje błąd owinięty w obiekt kontekstu', () => {
    reportIssueBackend({
      namespace: 'SWEEP',
      message: 'Sweep failed',
      payload: { error: new Error('advisory lock unavailable') },
      mode: 'error',
    });

    expect(lastRecord().payload).toContain('advisory lock unavailable');
  });

  it('nadal redaguje wrażliwe klucze payloadu', () => {
    reportIssueBackend({
      namespace: 'AUTH',
      message: 'boom',
      payload: { authorization: 'Bearer super-secret', userId: 'u1' },
      mode: 'error',
    });

    const payload = lastRecord().payload;
    expect(payload).not.toContain('super-secret');
    expect(payload).toContain('[REDACTED]');
    expect(payload).toContain('u1');
  });

  it('redaguje adres pod DOWOLNYM kluczem z rodziny *Email, nie tylko z wyliczanki', () => {
    // Regression: the name list had `email`/`customerEmail`/`ownerEmail` but not `userEmail` or
    // `reporterEmail`, exactly the fields the support and moderation alerts sent as
    // `payload: params` when no admin existed.
    reportIssueBackend({
      namespace: 'SUPPORT_ALERT_NO_ADMIN',
      message: 'boom',
      payload: {
        userEmail: 'anna.kowalska@gmail.com',
        reporterEmail: 'zgloszenie@wp.pl',
      },
      mode: 'error',
    });

    const payload = lastRecord().payload;
    expect(payload).not.toContain('anna.kowalska');
    expect(payload).not.toContain('zgloszenie@wp.pl');
    // Domena zostaje: to jedyny sygnał operacyjny, jaki adres niesie.
    expect(payload).toContain('[EMAIL]@gmail.com');
    expect(payload).toContain('[EMAIL]@wp.pl');
  });

  it('redaguje adres OSADZONY w komunikacie błędu dostawcy poczty', () => {
    // Regresja: `payload: error` z transportu pocztowego niósł adresata WEWNĄTRZ
    // `message`, a redaktor patrzył wyłącznie na klucze najwyższego poziomu.
    reportIssueBackend({
      namespace: 'MAGIC_LINK_DELIVERY',
      message: 'boom',
      payload: new Error(
        '550 5.1.1 <klientka@onet.pl>: Recipient address rejected'
      ),
      mode: 'error',
    });

    const payload = lastRecord().payload;
    expect(payload).not.toContain('klientka@onet.pl');
    expect(payload).toContain('[EMAIL]@onet.pl');
    // The failure reason MUST survive redaction, otherwise the entry cannot be reconstructed.
    expect(payload).toContain('Recipient address rejected');
  });

  it('redaguje adres zagnieżdżony głębiej niż jeden poziom', () => {
    reportIssueBackend({
      namespace: 'X',
      message: 'boom',
      payload: { responseBody: { contact: { mail: 'ktos@firma.pl' } } },
      mode: 'error',
    });

    const payload = lastRecord().payload;
    expect(payload).not.toContain('ktos@firma.pl');
    expect(payload).toContain('[EMAIL]@firma.pl');
  });

  it('data z payloadu wychodzi jako ISO (charakterystyka CALEJ sciezki)', () => {
    // Ten test mierzy SCIEZKE, nie ten modul: `serializeErrorLike` z jadra
    // normalizuje `Date` zanim redaktor cokolwiek zobaczy. Poprzednia wersja
    // udawala, ze pilnuje galezi w error-handler.ts — i przechodzila rowniez po
    // jej wycieciu, czyli nie umiala sie wywrocic na wlasnej klasie regresji.
    reportIssueBackend({
      namespace: 'PAIRING',
      message: 'boom',
      payload: { expires_at: new Date('2026-09-16T10:00:00.000Z') },
      mode: 'error',
    });

    expect(lastRecord().payload).toContain('2026-09-16T10:00:00.000Z');
  });

  it('redaguje adres w formie z nazwa wyswietlana', () => {
    // `"Anna Kowalska" <anna@x.com>` to forma, ktora produkuje transport pocztowy,
    // a dopasowanie CALOSCI jej nie lapalo — wartosc wychodzila doslownie.
    reportIssueBackend({
      namespace: 'MAIL',
      message: 'boom',
      payload: { to: '"Anna Kowalska" <anna@x.com>' },
      mode: 'error',
    });

    const payload = lastRecord().payload;
    expect(payload).not.toContain('anna@x.com');
    expect(payload).toContain('[EMAIL]@x.com');
  });

  it('adres pod literalem IP nadal jest redagowany', () => {
    // Wzorzec chroniacy wersje pakietow nie moze zrobic dziury w redakcji:
    // `192.168.1.10` ma cztery czlony, semver ma trzy.
    reportIssueBackend({
      namespace: 'MAIL',
      message: 'boom',
      payload: { detail: 'send to bob@192.168.1.10 now' },
      mode: 'error',
    });

    expect(lastRecord().payload).not.toContain('bob@192.168.1.10');
  });

  it('nie zjada wersji pakietu jako adresu', () => {
    // `next@16.3.4` pasuje do wzorca adresu; po redakcji kazdego liscia tekstowego
    // nazwa pakietu znikala jako „[EMAIL]@16.3.4".
    reportIssueBackend({
      namespace: 'BUILD',
      message: 'boom',
      payload: { detail: 'Cannot find module next@16.3.4 in /app' },
      mode: 'error',
    });

    expect(lastRecord().payload).toContain('next@16.3.4');
  });

  it('skanuje wartosc pod kluczem adresowym, gdy nie jest adresem', () => {
    // Galaz klucza adresowego ZAKLADALA ksztalt wartosci i nie schodzila glebiej,
    // wiec sekret zagniezdzony pod `emails` wychodzil nietkniety.
    reportIssueBackend({
      namespace: 'X',
      message: 'boom',
      payload: {
        emails: [{ to: 'a@b.com', authorization: 'Bearer secret-x' }],
      },
      mode: 'error',
    });

    const payload = lastRecord().payload;
    expect(payload).not.toContain('secret-x');
    expect(payload).toContain('[REDACTED]');
    expect(payload).toContain('[EMAIL]@b.com');
  });

  it('zapisuje cel żądania w client_url zamiast stałej domeny', () => {
    reportIssueBackend({
      namespace: 'X',
      message: 'boom',
      payload: null,
      mode: 'error',
    });

    expect(lastRecord().client_url).toBe('POST /api/v1/internal/track-crawler');
  });

  it('zapisuje user_id z ramki żądania, gdy sesja jest znana', () => {
    holder.userId = 'usr_known';
    reportIssueBackend({
      namespace: 'X',
      message: 'boom',
      payload: null,
      mode: 'error',
    });
    expect(lastRecord().user_id).toBe('usr_known');
  });

  it('poza kontekstem żądania oznacza rekord jako systemowy', () => {
    holder.requestTarget = undefined;

    reportIssueBackend({
      namespace: 'STARTUP',
      message: 'boom',
      payload: null,
      mode: 'error',
    });

    expect(lastRecord().client_url).toBe('system');
  });

  it('dla mode=error zapisuje stack także na produkcji', () => {
    reportIssueBackend({
      namespace: 'X',
      message: 'boom',
      payload: null,
      mode: 'error',
    });

    const metadata = JSON.parse(lastRecord().user_metadata) as {
      callstack: string[];
    };
    expect(metadata.callstack.length).toBeGreaterThan(0);
  });

  it('dla mode=warn NIE płaci za stack (kanał wysokowolumenowy)', () => {
    reportIssueBackend({
      namespace: 'X',
      message: 'ostrzeżenie',
      payload: null,
      mode: 'warn',
    });

    const metadata = JSON.parse(lastRecord().user_metadata) as {
      callstack: string[];
    };
    expect(metadata.callstack).toEqual([]);
  });
});

/**
 * PII in logs: an e-mail address is reduced to its domain at ONE seam.
 *
 * The raw recipient address used to reach the EventLog from ~14 call sites (mail transport and
 * adapters, dev-sink, address change, Stripe customer operations, newsletter signup). The log
 * database is SHARED between environments and a record has 90 days of retention. Fixing call sites
 * one by one leaves the class open, so redaction lives in the sanitizer and this suite keeps it there.
 *
 * It also pins what we do NOT do: no hashing. The address space is guessable by dictionary, so an
 * unsalted hash is pseudonymisation posing as anonymisation.
 */
describe('reportIssueBackend — redakcja adresów e-mail', () => {
  beforeEach(() => {
    holder.records.length = 0;
  });

  const payloadOf = (payload: Record<string, unknown>) => {
    reportIssueBackend({
      mode: 'error',
      namespace: 'TEST_PII',
      message: 'probe',
      payload,
    });
    return JSON.parse(lastRecord().payload) as Record<string, unknown>;
  };

  it('zostawia domenę, kasuje część osobową', () => {
    const out = payloadOf({ to: 'anna.kowalska@gmail.com' });
    expect(out.to).toBe('[EMAIL]@gmail.com');
  });

  it('obejmuje wszystkie nazwy kluczy, którymi adres wchodził do logu', () => {
    const out = payloadOf({
      email: 'a@x.pl',
      newEmail: 'b@x.pl',
      recipient: 'c@x.pl',
      customerEmail: 'd@x.pl',
      from: 'e@x.pl',
    });
    for (const key of [
      'email',
      'newEmail',
      'recipient',
      'customerEmail',
      'from',
    ]) {
      expect(out[key]).toBe('[EMAIL]@x.pl');
    }
  });

  it('redaguje także listę odbiorców', () => {
    const out = payloadOf({ recipients: ['a@x.pl', 'b@y.pl'] });
    expect(out.recipients).toEqual(['[EMAIL]@x.pl', '[EMAIL]@y.pl']);
  });

  it('NIE hashuje — w wyniku nie ma nic poza domeną i znacznikiem', () => {
    const out = payloadOf({ to: 'anna.kowalska@gmail.com' });
    expect(String(out.to)).not.toMatch(/[0-9a-f]{16,}/);
    expect(String(out.to)).not.toContain('anna');
    expect(String(out.to)).not.toContain('kowalska');
  });

  it('wartość nie-adresowa pod kluczem adresowym zostaje nietknięta', () => {
    // `to` bywa też nazwą pola nie-adresowego (zakres dat, cel przejścia stanu).
    const out = payloadOf({ to: 'ACTIVE', recipient: 42 });
    expect(out.to).toBe('ACTIVE');
    expect(out.recipient).toBe(42);
  });

  it('sekrety dalej idą na [REDACTED], nie na domenę', () => {
    const out = payloadOf({ authorization: 'Bearer abc', to: 'a@x.pl' });
    expect(out.authorization).toBe('[REDACTED]');
    expect(out.to).toBe('[EMAIL]@x.pl');
  });
  it('redaguje adres OSADZONY W KOMUNIKACIE, nie tylko w payloadzie', () => {
    // The worst leak variant: the payload next to it was already redacted, so the record LOOKED
    // clean while `message` carried the full address into the database and PostHog.
    reportIssueBackend({
      mode: 'error',
      namespace: 'TEST_PII',
      message: 'Invalid email address: "anna.kowalska@gmail.com"',
      payload: { to: 'anna.kowalska@gmail.com' },
    });
    const record = lastRecord() as unknown as { message: string };
    expect(record.message).toContain('[EMAIL]@gmail.com');
    expect(record.message).not.toContain('anna.kowalska');
  });

  it('obejmuje `identifier` — pole adresata magic-linka, czyli jedynej ścieżki logowania', () => {
    const out = payloadOf({ identifier: 'ktos@example.com' });
    expect(out.identifier).toBe('[EMAIL]@example.com');
  });

  it('komunikat bez adresu zostaje nietknięty', () => {
    reportIssueBackend({
      mode: 'error',
      namespace: 'TEST_PII',
      message: 'Sweep failed after 3 attempts',
      payload: {},
    });
    const record = lastRecord() as unknown as { message: string };
    expect(record.message).toBe('Sweep failed after 3 attempts');
  });
  it('redacts private note families before persisting diagnostics', () => {
    reportIssueBackend({
      namespace: 'NOTE_CONFLICT_REDACTION',
      message: 'Revision conflict',
      payload: {
        request: { note: 'private allergy', important_note: 'private safety' },
        response: { crmNote: 'private draft', client_notes: 'private history' },
        pair_id: 'pair-1',
        revision: 'revision-1',
      },
      mode: 'error',
    });
    const payload = lastRecord().payload;
    expect(payload).not.toContain('private');
    expect(payload).toContain('[REDACTED]');
    expect(payload).toContain('pair-1');
    expect(payload).toContain('revision-1');
  });
});
