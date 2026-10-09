/**
 * Audyt nieudanych logowań (CANNOT_LOGIN) — test kontraktu na `ctx.context.returned`.
 *
 * DLACZEGO TEN PLIK ISTNIEJE:
 * `better-auth` był przypięty dokładnie na 1.6.25 ze strachu, że `ctx.context.returned`
 * zniknie i ta ścieżka umrze PO CICHU — a przez cały ten czas nie miała ANI JEDNEGO testu.
 * Test jedzie na PRAWDZIWEJ klasie `APIError` z `better-auth/api` (nie na atrapie),
 * bo sednem jest dyskryminacja `isAPIError`: atrapa udowodniłaby wyłącznie, że atrapa
 * pasuje do naszego własnego regexa. Drugą połowę kontraktu — obecność przypisania
 * w runtime biblioteki — pilnuje `audit:better-auth-dispatch-contract`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { GenericEndpointContext } from 'better-auth';
import { APIError } from 'better-auth/api';

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  writeRawEventLog: vi.fn(),
  reportIssue: vi.fn(),
}));

vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: { use: { user: { findUnique: h.findUnique } } },
}));
vi.mock('@app/event-log/event-log.client', () => ({
  writeRawEventLog_IO: h.writeRawEventLog,
}));
vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: h.reportIssue,
}));
vi.mock('@app/http/extract-client-info', () => ({
  extractIpFromFetchHeaders: () => '203.0.113.9',
}));

import { handleAuthFailure } from './better-auth-failure-tracking';

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const makeCtx = (
  path: string,
  returned: unknown,
  body?: Record<string, unknown>
): GenericEndpointContext =>
  ({
    path,
    body,
    headers: new Headers({ 'user-agent': 'vitest', 'accept-language': 'pl' }),
    context: { returned },
  }) as unknown as GenericEndpointContext;

describe('handleAuthFailure — kontrakt ctx.context.returned', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.findUnique.mockResolvedValue({ id: 'user-1' });
    h.writeRawEventLog.mockResolvedValue(undefined);
  });

  it('zapisuje CANNOT_LOGIN dla rzuconego APIError (złe hasło)', async () => {
    handleAuthFailure(
      makeCtx(
        '/sign-in/email',
        new APIError('UNAUTHORIZED', { code: 'INVALID_EMAIL_OR_PASSWORD' }),
        { email: 'ofiara@example.test' }
      )
    );
    await flush();

    expect(h.writeRawEventLog).toHaveBeenCalledTimes(1);
    const payload = h.writeRawEventLog.mock.calls[0]?.[0] as {
      eventPayloadToStringify?: Record<string, unknown>;
    };
    expect(payload.eventPayloadToStringify).toMatchObject({
      reason_code: 'INVALID_EMAIL_OR_PASSWORD',
      status_code: 401,
    });
  });

  it('sygnalizuje nieudany redirect 302 z ?error= (magic-link verify, e-mail nieznany)', async () => {
    handleAuthFailure(
      makeCtx(
        '/magic-link/verify',
        new APIError(
          'FOUND',
          {},
          { location: 'https://front.test/login?error=EXPIRED_TOKEN' }
        )
      )
    );
    await flush();

    // Magic-link verify nie niesie ciała, więc e-mail jest nieznany, a EventLog ma FK
    // na użytkownika — sygnał idzie wtedy do trackera, nie do tabeli. To jest UDOKUMENTOWANE
    // zachowanie (DECISION w pliku źródłowym), nie zgubiony przypadek.
    expect(h.writeRawEventLog).not.toHaveBeenCalled();
    expect(h.reportIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'BA_HOOK_CANNOT_LOGIN',
        payload: expect.objectContaining({ reasonCode: 'EXPIRED_TOKEN' }),
      })
    );
  });

  it('MILCZY na redirekcie 302 BEZ ?error= — to jest udany login', async () => {
    handleAuthFailure(
      makeCtx(
        '/callback/google',
        new APIError('FOUND', {}, { location: 'https://front.test/app' })
      )
    );
    await flush();

    expect(h.writeRawEventLog).not.toHaveBeenCalled();
  });

  it('MILCZY, gdy returned nie jest APIError (ścieżka sukcesu, ciało JSON)', async () => {
    handleAuthFailure(
      makeCtx('/sign-in/email', { token: 'abc', user: { id: 'u' } })
    );
    await flush();

    expect(h.writeRawEventLog).not.toHaveBeenCalled();
  });

  /**
   * TO JEST TEN TEST. Dokładnie ten scenariusz uzasadniał przypięcie wersji:
   * gdy biblioteka przestanie ustawiać `returned`, funkcja dostaje `undefined`.
   * Sprawdzamy, że taki przebieg jest NIEODRÓŻNIALNY od ciszy — czyli że sam kod
   * NIE MA JAK tego zauważyć i że jedyną obroną jest strażnik nad runtime'em.
   */
  it('cicho nie robi nic, gdy returned zniknie — dlatego kontraktu pilnuje strażnik, nie test', async () => {
    handleAuthFailure(
      makeCtx('/sign-in/email', undefined, {
        email: 'ofiara@example.test',
      })
    );
    await flush();

    expect(h.writeRawEventLog).not.toHaveBeenCalled();
    expect(h.reportIssue).not.toHaveBeenCalled();
  });

  it('nie dotyka ścieżek spoza logowania', async () => {
    handleAuthFailure(
      makeCtx('/get-session', new APIError('UNAUTHORIZED', { code: 'X' }))
    );
    await flush();

    expect(h.writeRawEventLog).not.toHaveBeenCalled();
  });
});
