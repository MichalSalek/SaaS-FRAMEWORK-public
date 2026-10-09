// tests/concurrency/run-concurrency.ts
//
// Orchestrator for the LIVE concurrency suite (KROK 4). Imports every family file
// for its registration side-effect, runs the combined suite ONCE, then tears down
// deterministically (fixture cleanup → close pool) regardless of pass/fail, and
// exits non-zero on any failure.
//
// Requires a RUNNING dev backend + reachable Postgres. NOT part of run-all.sh /
// pre-commit (those are static + mock). Run:  cd tests && npm run test:concurrency
//
// Each family is self-isolating: it mints ephemeral `conc-` users + SQL-seeds its
// own source data, asserts directly on Postgres after a real HTTP race, and relies
// on the shared cleanupRun() (delete `conc-%` users → CASCADE) at the end.

import { runRegistered } from './_harness';
import { cleanupRun, cleanupAllStaleConcUsers } from './_fixtures';
import { closeDb } from '../utils/db-client';

// --- family registrations (import = register) --------------------------------
import './active-pair.concurrency';
import './gallery-delete-moderation.concurrency';
import './ban-user-state.concurrency';
import './free-select-webhook.concurrency';
import './bookmark-cascade.concurrency';
import './p2025-mapping.concurrency';
import './advisory-xact-lock.concurrency';

const main = async (): Promise<void> => {
  let ok = false;
  try {
    await cleanupAllStaleConcUsers(); // solo run — clear any crashed-run leftovers
    ok = await runRegistered('DB hardening — live concurrency (7 families)');
  } finally {
    await cleanupRun();
    await closeDb();
  }
  process.exit(ok ? 0 : 1);
};

main().catch(e => {
  console.error('Concurrency runner crashed:', e);
  process.exit(1);
});
