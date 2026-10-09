/**
 * tests/preflight.ts — TESTY-API readiness gate.
 *
 * One command that answers "is the dev backend reachable and is the test harness
 * wired correctly?" BEFORE any exploratory QA / smoke / hardening run. Every
 * testy-api session (FAZA 0) should run this first instead of ad-hoc curl + tsx.
 *
 * What it proves, end to end:
 *   1. SSOT URL/secret/origin resolution (derived from web-1/.env.development) —
 *      prints what it resolved so a drift (HTTP vs HTTPS, wrong DNS) is obvious.
 *   2. Backend is alive (public health endpoint answers).
 *   3. dev-login works for every role (stylist / client / admin) — token minted.
 *   4. An authenticated query works per role (token valid + CORS/origin accepted).
 *
 * Run:  cd tests && npm run test:preflight
 * Exit: 0 = ready, 1 = not ready (with a precise reason per check).
 *
 * Override the target without editing files (e.g. bypass Caddy, hit the HTTP upstream directly):
 *   TEST_API_URL=http://localhost:3001 npm run test:preflight
 */

import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import { TEST_CONFIG } from './config/test.config';
import {
  apiCall,
  getStylistToken,
  getClientToken,
  getAdminToken,
  getData,
  getEvent,
} from './utils/api-client';

type CheckResult = { name: string; ok: boolean; detail: string; soft?: boolean };

const results: CheckResult[] = [];
const record = (r: CheckResult): CheckResult => {
  results.push(r);
  const icon = r.ok ? '✅' : r.soft ? '⚠️ ' : '❌';
  console.log(`${icon} ${r.name.padEnd(34, '.')} ${r.detail}`);
  return r;
};

async function devLoginCheck(
  label: string,
  getToken: () => Promise<string>
): Promise<string | null> {
  try {
    const token = await getToken();
    if (!token || token.length < 16) {
      record({ name: `dev-login ${label}`, ok: false, detail: `bad token: "${token}"` });
      return null;
    }
    record({ name: `dev-login ${label}`, ok: true, detail: `token ${token.length}ch` });
    return token;
  } catch (e) {
    record({
      name: `dev-login ${label}`,
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

async function accountStateCheck(label: string, token: string): Promise<void> {
  try {
    const res = await apiCall({
      endpoint: ROUTES_API.USER_GET_ACCOUNT_STATE,
      token,
      method: 'GET',
    });
    if (res.status !== 200) {
      record({
        name: `account-state ${label}`,
        ok: false,
        detail: `status ${res.status} event ${getEvent(res)}`,
      });
      return;
    }
    const d = getData<Record<string, unknown>>(res);
    const flags = ['has_stylist_account', 'has_client_account']
      .filter(k => d[k])
      .join('+') || 'no-account-flags';
    record({ name: `account-state ${label}`, ok: true, detail: `200 ${getEvent(res)} (${flags})` });
  } catch (e) {
    record({
      name: `account-state ${label}`,
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

async function main(): Promise<void> {
  console.log('\n══════════ TESTY-API PREFLIGHT ══════════');
  console.log('Środowisko (SSOT-derived z web-1/.env.development):');
  console.log(`  API_URL : ${TEST_CONFIG.API_URL}`);
  console.log(`  ORIGIN  : ${TEST_CONFIG.ORIGIN}`);
  console.log(
    `  SECRET  : ${
      TEST_CONFIG.INTERNAL_SECRET
        ? `set (${TEST_CONFIG.INTERNAL_SECRET.length}ch)`
        : 'empty → header not sent'
    }`
  );
  console.log(`  ADMIN   : ${TEST_CONFIG.USERS.ADMIN_MAIN}`);
  console.log('─────────────────────────────────────────');

  // 1. Backend health (public, no auth). Anything that answers = alive.
  try {
    const res = await apiCall({
      endpoint: ROUTES_API.INTERNAL_HEALTH_PUBLIC,
      method: 'GET',
    });
    record({
      name: 'health-public',
      ok: res.status === 200,
      detail:
        res.status === 200
          ? '200 (backend alive)'
          : `unexpected status ${res.status}`,
    });
  } catch (e) {
    record({
      name: 'health-public',
      ok: false,
      detail: `${e instanceof Error ? e.message : String(e)} — backend down or wrong URL/proto`,
    });
  }

  // 2-4. dev-login + authed query per role.
  const stylistToken = await devLoginCheck('STYLIST', getStylistToken);
  if (stylistToken) await accountStateCheck('stylist', stylistToken);

  const clientToken = await devLoginCheck('CLIENT', getClientToken);
  if (clientToken) await accountStateCheck('client', clientToken);

  const adminToken = await devLoginCheck('ADMIN', getAdminToken);
  if (adminToken) await accountStateCheck('admin', adminToken);

  // Summary + exit code. Soft checks (⚠️) don't fail the gate.
  const hard = results.filter(r => !r.soft);
  const passed = hard.filter(r => r.ok).length;
  const failed = hard.filter(r => !r.ok);
  console.log('─────────────────────────────────────────');
  if (failed.length === 0) {
    console.log(`══ WYNIK: ${passed}/${hard.length} ✅ — GOTOWE DO TESTÓW ══\n`);
    process.exit(0);
  }
  console.log(`══ WYNIK: ${passed}/${hard.length} — NIEGOTOWE (${failed.length} fail) ══`);
  for (const f of failed) console.log(`   ❌ ${f.name}: ${f.detail}`);
  console.log(
    '\nHint: 000/empty-reply zwykle = zła PROTO/URL (backend na HTTPS, klient na HTTP)\n' +
      '      → sprawdź web-1/.env.development BETTER_AUTH_URL/PUBLIC_URL (SSOT) i Caddy/DNS.\n'
  );
  process.exit(1);
}

main().catch(e => {
  console.error('PREFLIGHT CRASH:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
