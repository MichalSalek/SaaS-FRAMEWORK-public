import { ENV_VARS } from './environment.config';

export const buildFrontendBaseUrl = (): string => {
  // DECISION (nie usuwaj tego komentarza):
  // FRONTEND_PUBLIC_DOMAIN może być listą rozdzieloną przecinkami w dev
  // (np. "localhost, 192.168.0.10:3000" dla dostępu z LAN). Bierzemy PIERWSZY wpis
  // + trim — parytet z buildTestOrigin w smoke-tests-runner.ts. Bez tego multi-value
  // domain produkował MALFORMED redirect Location ("https://localhost, 192.168.0.10:3000/...")
  // m.in. na email-unsubscribe GET (fetch nie mógł podążyć). Prod = pojedyncza domena → no-op.
  const domain = (
    (ENV_VARS.FRONTEND_PUBLIC_DOMAIN || 'nailfolio.app').split(',')[0] ??
    'nailfolio.app'
  ).trim();
  const port = ENV_VARS.FRONTEND_PUBLIC_PORT;
  return port ? `https://${domain}:${port}` : `https://${domain}`;
};

export const IS_DEVELOPMENT_ENV = (): boolean =>
  ENV_VARS.NODE_ENV_MANUAL?.toUpperCase() === 'DEVELOPMENT';

export const IS_PRODUCTION_ENV = (): boolean =>
  ENV_VARS.NODE_ENV_MANUAL?.toUpperCase() === 'PRODUCTION';

/**
 * Canonical environment modes. SSOT of the allowed values is the env-schema
 * enum (`env-schema.ts` → NODE_ENV_MANUAL enum: DEVELOPMENT/STAGING/PRODUCTION);
 * this union mirrors it for the typed accessor below. `UNKNOWN` is the explicit
 * sentinel for the (boot-validated-away, but type-reachable) case where the var
 * is absent.
 */
export type EnvironmentMode =
  'DEVELOPMENT' | 'STAGING' | 'PRODUCTION' | 'UNKNOWN';

const ENVIRONMENT_MODES: readonly EnvironmentMode[] = [
  'DEVELOPMENT',
  'STAGING',
  'PRODUCTION',
];

/**
 * Return the active environment as a stable enum value — NEVER a diagnostic
 * string.
 *
 * DECISION (nie usuwaj tego komentarza):
 * BDX W6.2 — wcześniej brak NODE_ENV_MANUAL zwracał diagnostyczny string
 * (`"NODE_ENV_MANUAL-not-provided". "process.env.NODE_ENV": ..."`). Ten string
 * wyciekał do KAŻDEGO rekordu EventLog (`environment` kolumna via reportIssueBackend)
 * oraz do admin /health payload (`backend.environment`) — zaśmiecając observability
 * niestrukturalnym tekstem niemożliwym do filtrowania/grupowania. ENV_VARS już
 * upper-case'uje NODE_ENV_MANUAL (environment.config.ts) i env-schema waliduje go do
 * enuma {DEVELOPMENT,STAGING,PRODUCTION} na boot, więc realnie zawsze trafiamy w enum;
 * `UNKNOWN` to jawny sentinel dla type-reachable braku (nie loud-string).
 */
export const getEnvironmentMode = (): EnvironmentMode => {
  const mode = ENV_VARS.NODE_ENV_MANUAL;
  return ENVIRONMENT_MODES.includes(mode as EnvironmentMode)
    ? (mode as EnvironmentMode)
    : 'UNKNOWN';
};
