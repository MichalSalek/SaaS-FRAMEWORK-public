import { describe, expect, it } from 'vitest';
import {
  describeErrorLike,
  serializeErrorLike,
} from '@kernel/application/error-serialization';

// RED-first guard dla regresji, ktora realnie wystapila na produkcji:
// `reportIssueBackend({ payload: err })` zapisywal `{}` / `{"clientVersion":"7.8.0"}`,
// gubiac powod bledu (incydent AI_CRAWLER_TRACK 2026-08-03/05). Kazdy test nizej
// failuje na starej implementacji (`JSON.stringify(error)`).

describe('serializeErrorLike — zachowanie komunikatu bledu', () => {
  it('zachowuje name/message/stack tam, gdzie goly JSON.stringify daje {}', () => {
    const error = new Error('Connection terminated due to connection timeout');

    expect(JSON.stringify(error)).toBe('{}'); // dowod na pierwotna przyczyne

    const serialized = serializeErrorLike(error) as Record<string, unknown>;
    expect(serialized.name).toBe('Error');
    expect(serialized.message).toBe(
      'Connection terminated due to connection timeout'
    );
    expect(typeof serialized.stack).toBe('string');
    expect(serialized.__error).toBe(true);
  });

  it('zachowuje wlasne pola bledu OBOK komunikatu (regresja Prisma)', () => {
    const error = Object.assign(new Error('Raw query failed. Code: `53000`.'), {
      clientVersion: '7.8.0',
      code: 'P2010',
    });

    const serialized = serializeErrorLike(error) as Record<string, unknown>;
    expect(serialized.clientVersion).toBe('7.8.0');
    expect(serialized.code).toBe('P2010');
    expect(serialized.message).toBe('Raw query failed. Code: `53000`.');
  });

  it('schodzi po nieenumerowalnym `cause` (Prisma → pg)', () => {
    const root = new Error('ECONNRESET');
    const wrapper = new Error('DriverAdapterError', { cause: root });

    const serialized = serializeErrorLike(wrapper) as Record<string, unknown>;
    const cause = serialized.cause as Record<string, unknown>;
    expect(cause.message).toBe('ECONNRESET');
  });

  it('rozpakowuje blad zagniezdzony w obiekcie i w tablicy', () => {
    const error = new Error('boom');

    const nested = serializeErrorLike({ payload: { id: 1 }, error }) as {
      error: Record<string, unknown>;
    };
    expect(nested.error.message).toBe('boom');

    const inArray = serializeErrorLike([error]) as Array<
      Record<string, unknown>
    >;
    expect(inArray[0]?.message).toBe('boom');
  });

  it('ten sam blad w rodzenstwie NIE jest falszywie oznaczany jako [circular]', () => {
    const error = new Error('shared');
    const serialized = serializeErrorLike({ a: error, b: error }) as {
      a: Record<string, unknown>;
      b: Record<string, unknown>;
    };
    expect(serialized.a.message).toBe('shared');
    expect(serialized.b.message).toBe('shared');
  });

  it('przerywa realny cykl zamiast zapetlic sie', () => {
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic.self = cyclic;

    const serialized = serializeErrorLike(cyclic) as Record<string, unknown>;
    expect(serialized.self).toBe('[circular]');
  });

  it('wycina credentiale z connection stringa w komunikacie', () => {
    const error = new Error(
      'connect failed: postgresql://neon_user:s3cr3t@ep-damp-dawn.eu-central-1.aws.neon.tech/neondb'
    );

    const serialized = serializeErrorLike(error) as Record<string, unknown>;
    expect(serialized.message).not.toContain('s3cr3t');
    expect(serialized.message).toContain('[REDACTED]@');
  });

  it('wycina sekret z query-stringa w dowolnym stringu payloadu', () => {
    const serialized = serializeErrorLike({
      url: 'https://api.example.com/x?api_key=abc123&page=2',
    }) as Record<string, unknown>;

    expect(serialized.url).toBe(
      'https://api.example.com/x?api_key=[REDACTED]&page=2'
    );
  });

  it('przepuszcza prymitywy bez zmian', () => {
    expect(serializeErrorLike(42)).toBe(42);
    expect(serializeErrorLike(null)).toBe(null);
    expect(serializeErrorLike(undefined)).toBe(undefined);
    expect(serializeErrorLike(true)).toBe(true);
  });

  it('wynik jest serializowalny przez JSON.stringify', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() =>
      JSON.stringify(serializeErrorLike({ error: new Error('x'), cyclic }))
    ).not.toThrow();
  });
});

describe('describeErrorLike — streszczenie do pola message', () => {
  it('streszcza instancje Error', () => {
    expect(describeErrorLike(new TypeError('bad input'))).toBe(
      'TypeError: bad input'
    );
  });

  it('streszcza obiekt bledo-podobny', () => {
    expect(describeErrorLike({ name: 'PgError', message: 'timeout' })).toBe(
      'PgError: timeout'
    );
  });

  it('zwraca pusty string, gdy nie ma czytelnego komunikatu', () => {
    expect(describeErrorLike({ code: 500 })).toBe('');
    expect(describeErrorLike(null)).toBe('');
  });
});
