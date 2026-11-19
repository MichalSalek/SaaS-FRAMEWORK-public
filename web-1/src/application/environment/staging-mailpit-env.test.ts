import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENV_SCHEMA, validateEnvSchema } from './env-schema';

function completeEnv(mode: 'STAGING' | 'PRODUCTION') {
  const values: Record<string, string | boolean | undefined> = {
    NODE_ENV_MANUAL: mode,
  };
  for (const spec of ENV_SCHEMA) {
    if (
      spec.required === 'optional' ||
      (spec.requiredWhen && !spec.requiredWhen(values))
    ) {
      continue;
    }
    values[spec.name] =
      spec.name === 'NODE_ENV_MANUAL'
        ? mode
        : spec.format === 'url'
          ? 'https://example.test'
          : spec.format === 'int'
            ? '1'
            : spec.format === 'bool'
              ? false
              : spec.format === 'enum'
                ? spec.enum?.[0]
                : 'test-value';
  }
  if (mode === 'STAGING') {
    values.MAILPIT_HOST = 'mailpit';
    values.MAILPIT_PORT = '1025';
  }
  return values;
}
let exit: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  exit = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('exit');
  }) as never);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe('staging Mailpit configuration', () => {
  it('requires the isolated sink, but no live Mailgun credentials', () => {
    const env = completeEnv('STAGING');
    delete env.MAILGUN_API_KEY;
    delete env.MAILGUN_API_BASE_URL;
    delete env.MAILGUN_DOMAIN;
    expect(() => validateEnvSchema(env)).not.toThrow();
    expect(exit).not.toHaveBeenCalled();
  });
  it('refuses missing or non-Mailpit hosts and ports', () => {
    const env = completeEnv('STAGING');
    for (const [host, port] of [
      ['', '1025'],
      ['example.test', '1025'],
      ['mailpit', '25'],
    ]) {
      expect(() =>
        validateEnvSchema({ ...env, MAILPIT_HOST: host, MAILPIT_PORT: port })
      ).toThrow('exit');
    }
  });
  it('still requires the production provider configuration', () => {
    const env = completeEnv('PRODUCTION');
    delete env.MAILGUN_API_KEY;
    expect(() => validateEnvSchema(env)).toThrow('exit');
  });
});
