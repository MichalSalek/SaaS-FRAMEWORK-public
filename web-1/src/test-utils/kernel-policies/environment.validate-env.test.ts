import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateEnv } from '@kernel/application/environment';

/**
 * REGRESJA (czerwony przed poprawka) — TLUMIENIE POWTORZEN NIE MOZE POLYKAC WERDYKTU.
 *
 * `validateEnv` tlumi powtorzony wydruk plikiem-znacznikiem `/tmp/env_validated_<projekt>_<PPID>`.
 * Wczesniej galaz EEXIST robila gole `return`, czyli wychodzila z CALEJ funkcji — razem z
 * `process.exit(1)` nizej. Skutek: drugi i kazdy kolejny start z brakiem krytycznej zmiennej
 * srodowiskowej wstawal cicho zamiast paść. Znacznik jest kluczowany PPID-em, a `main/` chodzi
 * pod PM2 (PPID demona staly miedzy restartami aplikacji, /tmp przezywa restart), wiec to nie
 * byl przypadek teoretyczny — wystarczyl jeden wczesniejszy nieudany start.
 *
 * Test odtwarza dokladnie ten stan: ZAWCZASU tworzy plik-znacznik, potem wola walidacje w
 * trybie twardym i sprawdza, ze proces mimo to zostal zatrzymany.
 */
describe('validateEnv — plik-znacznik tlumi wydruk, nie werdykt', () => {
  const projectName = `vitest-env-gate-${process.pid}`;
  const flagFile = path.join(
    os.tmpdir(),
    `env_validated_${projectName}_${process.env?.PPID || process.ppid || 'unknown'}`
  );

  const removeFlag = () => {
    try {
      fs.unlinkSync(flagFile);
    } catch {
      // nie istnial — nic do sprzatania
    }
  };

  beforeEach(removeFlag);
  afterEach(() => {
    removeFlag();
    vi.restoreAllMocks();
  });

  const runHardModeWithMissingVar = () => {
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // Brak NODE_ENV_MANUAL=DEVELOPMENT => tryb TWARDY (fail-fast).
    validateEnv({ SOME_REQUIRED_VAR: undefined }, projectName);

    return { exit, error, warn };
  };

  it('konczy proces przy braku zmiennej, gdy znacznika JESZCZE nie ma', () => {
    const { exit } = runHardModeWithMissingVar();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('konczy proces rowniez wtedy, gdy znacznik JUZ istnieje (regresja fail-open)', () => {
    fs.writeFileSync(flagFile, '');
    const { exit, error } = runHardModeWithMissingVar();
    expect(exit).toHaveBeenCalledWith(1);
    // Tryb twardy drukuje bezwarunkowo — komunikat o brakach nie jest tlumiony.
    expect(error).toHaveBeenCalled();
  });

  it('nie rusza procesu, gdy komplet zmiennych jest obecny', () => {
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    validateEnv({ SOME_REQUIRED_VAR: 'value' }, projectName);
    expect(exit).not.toHaveBeenCalled();
  });
});
