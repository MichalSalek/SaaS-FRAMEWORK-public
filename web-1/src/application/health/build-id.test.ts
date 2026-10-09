import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `getBuildId` cache'uje odczyt na poziomie modułu, więc każdy przypadek startuje
 * od `vi.resetModules()` + świeżego dynamicznego importu — inaczej drugi test
 * czytałby wynik pierwszego zamiast własnego mocka.
 */
const loadModule = async (readFileSyncImpl: () => string) => {
  vi.resetModules();
  vi.doMock('node:fs', () => ({
    readFileSync: vi.fn(readFileSyncImpl),
  }));
  return import('./build-id');
};

describe('getBuildId', () => {
  afterEach(() => {
    vi.doUnmock('node:fs');
    vi.resetModules();
  });

  it('zwraca zawartość .next/BUILD_ID bez białych znaków', async () => {
    const { getBuildId } = await loadModule(() => 'aBc123-artifact\n');

    expect(getBuildId()).toBe('aBc123-artifact');
  });

  it('czyta plik tylko raz (health-check bywa pingowany co ~2 s)', async () => {
    let reads = 0;
    const { getBuildId } = await loadModule(() => {
      reads += 1;
      return 'stable-id';
    });

    getBuildId();
    getBuildId();
    getBuildId();

    expect(reads).toBe(1);
  });

  it('degraduje do "unknown", gdy artefaktu nie ma (tryb dev)', async () => {
    const { getBuildId, UNKNOWN_BUILD_ID } = await loadModule(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    expect(getBuildId()).toBe(UNKNOWN_BUILD_ID);
  });

  it('degraduje do "unknown" przy pustym pliku (przerwany build)', async () => {
    const { getBuildId, UNKNOWN_BUILD_ID } = await loadModule(() => '  \n');

    expect(getBuildId()).toBe(UNKNOWN_BUILD_ID);
  });
});
