import { describe, it, expect } from 'vitest';
import {
  assertDemoSeedAllowed,
  DemoSeedForbiddenError,
  resolveDemoSeedGate,
} from './demo-content-seeding.guard';

const LOCAL_URL = 'postgresql://u:p@db:5432/db?schema=public';

describe('assertDemoSeedAllowed', () => {
  it.each(['DEVELOPMENT', 'STAGING', 'staging'])(
    'przepuszcza %s na lokalnej bazie',
    env => {
      expect(
        assertDemoSeedAllowed({ nodeEnvManual: env, databaseUrl: LOCAL_URL })
      ).toEqual({ env: env.toUpperCase(), dbHost: 'db' });
    }
  );

  it.each(['PRODUCTION', 'PREVIEW', '', 'PROD', undefined])(
    'odmawia środowiska %s nawet na lokalnej bazie',
    env => {
      expect(() =>
        assertDemoSeedAllowed({ nodeEnvManual: env, databaseUrl: LOCAL_URL })
      ).toThrow(DemoSeedForbiddenError);
    }
  );

  it('odmawia zdalnej bazy mimo środowiska DEVELOPMENT (dryf env)', () => {
    expect(() =>
      assertDemoSeedAllowed({
        nodeEnvManual: 'DEVELOPMENT',
        databaseUrl:
          'postgresql://u:p@ep-x-pooler.eu-west-2.aws.neon.tech/db?sslmode=require',
      })
    ).toThrow(/not a local host/);
  });

  it('odmawia hosta, który tylko zaczyna się od lokalnej nazwy', () => {
    expect(() =>
      assertDemoSeedAllowed({
        nodeEnvManual: 'STAGING',
        databaseUrl: 'postgresql://u:p@db.example.org:5432/db',
      })
    ).toThrow(DemoSeedForbiddenError);
  });

  it('przepuszcza localhost i IPv6 loopback (uruchomienie z hosta / tunel)', () => {
    expect(
      assertDemoSeedAllowed({
        nodeEnvManual: 'STAGING',
        databaseUrl: 'postgresql://u:p@localhost:3299/db',
      }).dbHost
    ).toBe('localhost');
    expect(
      assertDemoSeedAllowed({
        nodeEnvManual: 'DEVELOPMENT',
        databaseUrl: 'postgresql://u:p@[::1]:5432/db',
      }).dbHost
    ).toBe('::1');
  });

  it('odmawia brakującego albo nieparsowalnego DATABASE_URL', () => {
    expect(() =>
      assertDemoSeedAllowed({ nodeEnvManual: 'STAGING', databaseUrl: '' })
    ).toThrow(/missing or unparseable/);
    expect(() =>
      assertDemoSeedAllowed({
        nodeEnvManual: 'STAGING',
        databaseUrl: 'not a url',
      })
    ).toThrow(/missing or unparseable/);
  });
});

describe('resolveDemoSeedGate', () => {
  const neon = 'postgresql://u:p@ep-x.neon.tech/db';

  it('BOOT na STAGING nie rusza (auto-seed tylko na DEVELOPMENT)', () => {
    expect(
      resolveDemoSeedGate({
        trigger: 'BOOT',
        nodeEnvManual: 'STAGING',
        databaseUrl: LOCAL_URL,
      }).run
    ).toBe(false);
  });

  it('BOOT z odmową bramki pomija zamiast rzucać (start backendu przeżywa)', () => {
    const gate = resolveDemoSeedGate({
      trigger: 'BOOT',
      nodeEnvManual: 'DEVELOPMENT',
      databaseUrl: neon,
    });
    expect(gate).toEqual({
      run: false,
      reason: expect.stringContaining('not a local host'),
    });
  });

  it('CLI z odmową bramki rzuca', () => {
    expect(() =>
      resolveDemoSeedGate({
        trigger: 'CLI',
        nodeEnvManual: 'PRODUCTION',
        databaseUrl: LOCAL_URL,
      })
    ).toThrow(DemoSeedForbiddenError);
  });

  it('CLI na STAGING z lokalną bazą rusza', () => {
    expect(
      resolveDemoSeedGate({
        trigger: 'CLI',
        nodeEnvManual: 'STAGING',
        databaseUrl: LOCAL_URL,
      })
    ).toEqual({ run: true });
  });
});
