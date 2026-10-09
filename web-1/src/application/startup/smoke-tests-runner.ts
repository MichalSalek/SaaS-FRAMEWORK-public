/**
 * Automatic Smoke Tests Runner
 *
 * Runs the smoke suite after application startup + seeding and prints ONE concise,
 * human-readable summary at the end (passed/failed/rate + per-failure reason).
 *
 * Outcomes are never misleading — three clearly distinct states:
 *   🟢 all passed · 🟡 only known env/flake failures (NOT a regression) · 🔴 real regression.
 * A genuine crash/timeout (no parseable summary) is reported separately from "tests failed",
 * so `process.exit(1)` from a couple of failing tests is never mislabelled "APPLICATION BROKEN".
 *
 * Environment handling:
 * - Overrides TEST_API_URL to localhost:{PORT} (in-process execution, not the host-mapped port)
 * - Overrides TEST_ORIGIN from FRONTEND_PUBLIC_DOMAIN (correct CORS for any environment)
 * - Gracefully skips if the tests directory is not available (e.g. Render-style deployments)
 */

import { reportIssueBackend } from '@app/debugger/error-handler';
import { ENV_VARS } from '@app/environment/environment.config';

const SMOKE_TESTS_DELAY = 15000; // 15s after startup to avoid race conditions (standalone needs time on slow hardware)
const SMOKE_TESTS_ENABLED = ENV_VARS.RUN_SMOKE_TESTS_ON_STARTUP;
const SMOKE_TESTS_TIMEOUT = 600000; // 10 min — full suite (RBAC matrix ~339 reqs) with rate-limit backoff can exceed 5 min

// Known environmental / flaky failures — these are NOT application regressions.
// dev sends real email via Mailgun (daily send limit); the strict rate-limit test is timing-sensitive;
// per-hour quotas (shares) can carry over across restarts that reuse the DB volume.
const ENV_FAILURE_PATTERNS: ReadonlyArray<{ re: RegExp; tag: string }> = [
  {
    re: /delivery failed|mailgun|too many requests|daily request limit/i,
    tag: 'ENV · email (Mailgun limit)',
  },
  {
    re: /quota.?exceeded|shares.?per.?hour|per.?hour.?limit/i,
    tag: 'FLAKE · quota (zużyta baza / poprzedni run)',
  },
  {
    re: /rate.?limit|never received it|\b429\b/i,
    tag: 'FLAKE · rate-limit timing',
  },
];

interface SmokeFailure {
  name: string;
  detail: string;
  env: string | null; // non-null = matched a known env/flake pattern (not a regression)
}

interface SmokeSummary {
  parsed: boolean; // false = output had no recognizable summary (crash/timeout, not a test result)
  total: number;
  passed: number;
  failed: number;
  rate: string;
  failures: SmokeFailure[];
}

const buildTestOrigin = (): string => {
  const frontendDomain = (
    (ENV_VARS.FRONTEND_PUBLIC_DOMAIN || 'localhost').split(',')[0] ??
    'localhost'
  ).trim();
  const frontendPort = ENV_VARS.FRONTEND_PUBLIC_PORT;
  const isLocal = frontendDomain === 'localhost' || /^\d/.test(frontendDomain);
  const protocol = isLocal ? 'http' : 'https';
  return frontendPort
    ? `${protocol}://${frontendDomain}:${frontendPort}`
    : `${protocol}://${frontendDomain}`;
};

const findTestsPath = async (): Promise<string | null> => {
  const fs = await import('fs');
  if (fs.existsSync('/tests/package.json')) {
    return '/tests';
  }
  if (fs.existsSync('./tests/package.json')) {
    return './tests';
  }
  return null;
};

/** Parse the human summary printed by tests/run-smoke-tests.ts into structured data. */
const parseSmokeOutput = (stdout: string): SmokeSummary => {
  const parsed = /Total:\s*\d+/.test(stdout) && /Success rate:/.test(stdout);
  const num = (re: RegExp): number => Number(stdout.match(re)?.[1] ?? 0);

  const failures: SmokeFailure[] = [];
  const block = stdout.split(/FAILED TESTS:/)[1] ?? '';
  const lines = block.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]?.match(/^\s+-\s+(.+?)\s*$/);
    if (!match) {
      continue;
    }
    const name = (match[1] ?? '').trim();
    const detail = (lines[i + 1] ?? '').trim();
    const env =
      ENV_FAILURE_PATTERNS.find(p => p.re.test(`${name} ${detail}`))?.tag ??
      null;
    failures.push({ name, detail, env });
  }

  return {
    parsed,
    total: num(/Total:\s*(\d+)/),
    passed: num(/Passed:\s*(\d+)/),
    failed: num(/Failed:\s*(\d+)/),
    rate: stdout.match(/Success rate:\s*([\d.]+%)/)?.[1] ?? '—',
    failures,
  };
};

export const runSmokeTestsAfterStartup = async (): Promise<void> => {
  if (!SMOKE_TESTS_ENABLED) {
    console.log(
      'ℹ️  Smoke tests on startup: DISABLED (set RUN_SMOKE_TESTS_ON_STARTUP=true to enable)'
    );
    return;
  }

  console.log(`⏳ Smoke tests will run in ${SMOKE_TESTS_DELAY}ms...`);

  setTimeout(() => {
    void (async () => {
      const testsPath = await findTestsPath();
      if (!testsPath) {
        console.log(
          'ℹ️  Smoke tests skipped: tests directory not found (expected on Render-style deployments)'
        );
        return;
      }

      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // DECISION (nie usuwaj tego komentarza):
      // TLS terminuje na EDGE (Caddy LE, subdomeny dev/api.dev). Upstreamy —
      // w tym ten backend — serwuja zwykle HTTP na :PORT, wiec self-smoke uderza http://localhost.
      // NIE zmieniaj na https:// (to bylby mkcert legacy, usuniety 2026-06-25): localhost = HTTP,
      // a secure-context dla Stripe (crypto.subtle) daje Caddy na subdomenie, nie ten upstream.
      const testApiUrl = `http://localhost:${ENV_VARS.PORT || 3000}`;
      const testOrigin = buildTestOrigin();
      console.log(`🔬 Smoke tests: running against ${testApiUrl} ...`);

      // Reuse the bind-mounted host tests/node_modules directly (linux↔linux on WSL2).
      // No `rm -rf node_modules && npm install`: this container runs as root and would
      // leave host tests/node_modules root-owned → break the next `dev:init` (EACCES).
      const started = Date.now();
      let stdout = '';
      let stderr = '';
      let crashError: Error | null = null;
      let timedOut = false;

      try {
        const res = await execAsync(
          `cd ${testsPath} && npx tsx run-smoke-tests.ts`,
          {
            timeout: SMOKE_TESTS_TIMEOUT,
            env: {
              ...process.env,
              TEST_API_URL: testApiUrl,
              TEST_ORIGIN: testOrigin,
              MASTER_ADMIN_EMAIL: ENV_VARS.MASTER_ADMIN_EMAIL,
            },
          }
        );
        stdout = res.stdout;
        stderr = res.stderr;
      } catch (error) {
        // exec rejects on non-zero exit. run-smoke-tests.ts exits 1 whenever ANY test
        // fails — a normal result, not a crash. The captured stdout still holds the full
        // summary, so we parse it regardless. Only a missing summary = real crash/timeout.
        const e = error as {
          stdout?: string;
          stderr?: string;
          killed?: boolean;
          signal?: string;
        };
        stdout = e.stdout ?? '';
        stderr = e.stderr ?? '';
        timedOut = e.killed === true || e.signal === 'SIGTERM';
        crashError = error instanceof Error ? error : new Error(String(error));
      }

      const elapsed = Math.round((Date.now() - started) / 1000);
      const summary = parseSmokeOutput(stdout);
      const rule = '─'.repeat(64);

      // No parseable summary → the suite never finished (crash, timeout, or runner couldn't start).
      if (!summary.parsed) {
        console.error(`\n${rule}`);
        console.error(`🔴 SMOKE TESTS — NIE UKOŃCZONO (${elapsed}s)`);
        console.error(
          timedOut
            ? `   Przyczyna: TIMEOUT (suite > ${SMOKE_TESTS_TIMEOUT / 1000}s)`
            : '   Przyczyna: runner nie wystartował / przerwany — to NIE wynik testów'
        );
        if (crashError) {
          console.error(`   ${crashError.message.split('\n')[0]}`);
        }
        console.error(`${rule}\n`);
        reportIssueBackend({
          namespace: 'STARTUP_SMOKE_TESTS',
          message: timedOut
            ? 'Smoke tests TIMED OUT on startup'
            : 'Smoke tests runner produced no result (crash)',
          payload: {
            stderr: stderr.slice(0, 2000),
            message: crashError?.message,
          },
          mode: 'error',
        });
        return;
      }

      const realFails = summary.failures.filter(f => !f.env);
      const envFails = summary.failures.filter(f => f.env);
      const healthy = summary.failed === 0;
      const onlyEnv = !healthy && realFails.length === 0;

      const badge = healthy ? '🟢' : onlyEnv ? '🟡' : '🔴';
      const verdict = healthy
        ? 'wszystkie testy przeszły — aplikacja zdrowa'
        : onlyEnv
          ? `${summary.failed} fail(e) to wyłącznie znane env/flake — NIE regresja (aplikacja zdrowa)`
          : `${realFails.length} fail(e) WYMAGA UWAGI (możliwa regresja)${envFails.length ? ` + ${envFails.length} env/flake` : ''}`;

      // 🟢/🟡 are not alarming → stdout; 🔴 real regression → stderr.
      const write = healthy || onlyEnv ? console.log : console.error;
      write(`\n${rule}`);
      write(
        `${badge} SMOKE TESTS  ${summary.passed}/${summary.total} passed (${summary.rate})  ·  ${summary.failed} failed  ·  ${elapsed}s`
      );
      if (summary.failures.length > 0) {
        write('   Faile:');
        for (const f of summary.failures) {
          write(`    • ${f.name}  [${f.env ?? '⚠ DO SPRAWDZENIA'}]`);
          if (f.detail) {
            write(`        ${f.detail.slice(0, 160)}`);
          }
        }
      }
      write(`   → ${verdict}`);
      write(`${rule}\n`);

      // Escalate to the error tracker ONLY for genuine regressions — never Mailgun/flake noise.
      if (realFails.length > 0) {
        reportIssueBackend({
          namespace: 'STARTUP_SMOKE_TESTS',
          message: `Smoke tests: ${realFails.length} unexpected failure(s) on startup`,
          payload: {
            failures: realFails,
            rate: summary.rate,
            total: summary.total,
          },
          mode: 'error',
        });
      }
    })();
  }, SMOKE_TESTS_DELAY);
};
