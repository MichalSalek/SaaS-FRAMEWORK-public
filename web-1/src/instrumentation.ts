export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./application/environment/environment.config');

    // Register event-bus listeners (side-effect import).
    // Each listener subscribes to its INFO event at module load time.
    // Must run before any handler can emit — instrumentation is the only
    // guaranteed single-process bootstrap on serverless and long-running Node.
    await import('./application/email-handler/event-listeners');
    // Notification-centre listeners (v2): same bus, same single-process bootstrap.
    await import('./domain/notifications/event-listeners');

    // Global error handlers — registered before seeding for maximum coverage
    const { reportIssueBackend } =
      await import('./application/debugger/error-handler');
    const { flushPostHogServer } =
      await import('./application/debugger/posthog-server');
    const { DB_CLIENT } = await import('./application/db/db.client');
    const { startNeonComputeQuotaMonitor } =
      await import('./application/health/neon-compute-quota.monitor');
    const stopNeonComputeQuotaMonitor = startNeonComputeQuotaMonitor();

    let isShuttingDown = false;

    process.on('unhandledRejection', (reason: unknown) => {
      reportIssueBackend({
        namespace: 'PROCESS_UNHANDLED_REJECTION',
        message: `Unhandled Promise Rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
        payload:
          reason instanceof Error
            ? { message: reason.message, stack: reason.stack }
            : { reason: String(reason) },
        mode: 'error',
      });
    });

    process.on('uncaughtException', (error: Error) => {
      reportIssueBackend({
        namespace: 'PROCESS_UNCAUGHT_EXCEPTION',
        message: `Uncaught Exception: ${error.message}`,
        payload: { message: error.message, stack: error.stack },
        mode: 'error',
      });
      // Flush before exit. Otherwise the crash $exception never leaves the process:
      // captureException queues an async POST and process.exit does not drain I/O.
      // The timeout inside flushPostHogServer still lets the process exit.
      // finally always calls exit(1).
      void flushPostHogServer().finally(() => process.exit(1));
    });

    const gracefulShutdown = async (signal: string) => {
      // DECISION: with NEXT_MANUAL_SIG_HANDLE this is the ONLY exit path, so it must always end the
      // process: a second signal exits at once, and a hard deadline (under Render's ~30 s grace)
      // exits even if a disconnect hangs on a query.
      if (isShuttingDown) {
        process.exit(signal === 'SIGINT' ? 130 : 143);
      }
      isShuttingDown = true;
      setTimeout(() => process.exit(0), 25_000).unref();
      stopNeonComputeQuotaMonitor();

      reportIssueBackend({
        namespace: 'PROCESS_SHUTDOWN',
        message: `Received ${signal}, shutting down gracefully`,
        payload: { signal },
        mode: 'info',
      });

      try {
        // Drain in-flight runAfterResponse effects BEFORE flushing logs / DB
        // disconnect. SIGTERM fires on every Render redeploy, and these
        // best-effort tasks (Stripe cancel, audit writes, transactional
        // emails, Resend audience sync, ...) would otherwise be abandoned
        // mid-flight (floating promise, no waitUntil off Vercel). Bounded (10 s)
        // so a hung effect never blocks the exit; runs first so effect-produced
        // logs still land in the buffer flush below.
        const { drainAfterResponseTasks } =
          await import('./application/runtime/run-after-response');
        const drainedEffects = await drainAfterResponseTasks(10_000);
        if (drainedEffects > 0) {
          // Logged BEFORE the buffer flush below so it lands. On the first real
          // redeploy after deploy, grep PROCESS_SHUTDOWN_DRAIN = live proof the
          // drain ran, plus ongoing operational visibility.
          reportIssueBackend({
            namespace: 'PROCESS_SHUTDOWN_DRAIN',
            message: `Drained ${drainedEffects} in-flight runAfterResponse effect(s) before exit`,
            payload: { drained: drainedEffects, signal },
            // 'warn', not 'info': info is dropped outside debug mode, so the
            // proof this comment promises never landed.
            mode: 'warn',
          });
        }

        // Flush in-memory log buffer before disconnecting — with 5 s timeout
        // so a slow DB write never blocks the shutdown indefinitely.
        const { flushLogBuffer } =
          await import('./application/debugger/error-handler-io');
        await Promise.race([
          flushLogBuffer(),
          new Promise<void>(resolve => setTimeout(resolve, 5_000)),
        ]);

        // Drain PostHog queue too — SIGTERM leci przy KAŻDYM redeploy, ostatnie
        // błędy/warny przed zejściem inaczej ginęłyby (flushAt:1 zdąża zwykle, ale
        // flush() gwarantuje wyjście promise-queue). Bounded (własny timeout).
        await flushPostHogServer();

        await Promise.race([
          Promise.all([
            DB_CLIENT.use.$disconnect(),
            DB_CLIENT.useAppLogs.$disconnect(),
          ]),
          new Promise<void>(resolve => setTimeout(resolve, 3_000)),
        ]);
      } catch {
        // Best effort — process exits regardless
      }

      process.exit(0);
    };

    // DECISION: `npm start` sets NEXT_MANUAL_SIG_HANDLE=true (web-1/package.json). Without it
    // `next start` registers its own SIGTERM handler that closes the server and calls
    // process.exit(143) while this async shutdown is still draining, so Stripe cancels, audit writes
    // and emails queued by runAfterResponse died on every Render redeploy. With no listener at all
    // (register failed before this line) Node's default still terminates on SIGTERM.
    process.on('SIGTERM', () => {
      void gracefulShutdown('SIGTERM');
    });
    process.on('SIGINT', () => {
      void gracefulShutdown('SIGINT');
    });

    reportIssueBackend({
      namespace: 'STARTUP',
      message: 'Seeding database',
      payload: null,
      mode: 'info',
    });

    // Cold-start metric: how long the blocking seeding sequence takes (permissions,
    // master admin, runtime/plan/gallery/feature-flag/test/demo seeds). Dominant cost
    // of the first request after a deploy (lazy-cron, no warm pool). Reported via
    // verbose diagnostics; successful initialization is not a degraded service.
    const seedingStart = process.hrtime.bigint();

    // 1. Initialize permissions system (roles, permissions, cache)
    const { initializePermissionsSystem } =
      await import('./application/permissions/permissions.init');
    await initializePermissionsSystem();

    // 2. Initialize Master Admin (auto-seed)
    const { initializeMasterAdmin_IO } =
      await import('./domain/admin/operations/admin-seeding.operations');
    const masterAdminResult = await initializeMasterAdmin_IO();
    reportIssueBackend({
      namespace: 'STARTUP',
      message: `Master Admin: ${masterAdminResult.message}`,
      payload: null,
      mode: 'info',
    });

    // 2.5. Seed Runtime Configs
    const { seedRuntimeConfigs } =
      await import('./domain/admin/seed/runtime-config.seed');
    if (masterAdminResult.adminUserId) {
      await seedRuntimeConfigs(masterAdminResult.adminUserId);
    }

    // 2.6. Load verbose + API timing flags once. Admin writes update this process
    // event-driven; permanent DB polling would keep serverless Postgres awake.
    // Establish the durable launch cutoff before any onboarding request can run.
    const { initializeFreeEmailCampaign_IO } =
      await import('./domain/email/operations/free-email.enrollment');
    await initializeFreeEmailCampaign_IO();

    const { initializeDebuggerStateFromDB } =
      await import('./application/debugger/debugger.state');
    const { getRuntimeConfigValue } =
      await import('./domain/admin/operations/admin-runtime-config.operations');
    await initializeDebuggerStateFromDB(getRuntimeConfigValue);

    // 4. Seed Gallery Data (colors, traits)
    const { seedGalleryData } =
      await import('./application/gallery/gallery.seed');
    await seedGalleryData();

    // 5. Seed Feature Flags
    const { seedFeatureFlags } =
      await import('./application/feature-flags/feature-flags.seed');
    await seedFeatureFlags();

    // 6. Seed Test Users (DEVELOPMENT or when smoke tests enabled)
    const { seedTestUsers_IO } =
      await import('./domain/admin/operations/admin-seeding.operations');
    const testUsersResult = await seedTestUsers_IO();
    reportIssueBackend({
      namespace: 'STARTUP',
      message: `Test Users: ${testUsersResult.message}`,
      payload: null,
      mode: 'info',
    });

    // 6.5. Seed Demo Content (DEVELOPMENT-only) — trwala wystawa na kontach
    // demo-* (galeria, para, sesje, ulubione, support) do recznego klikania
    // i QA wizualnego. Smoke testy tych kont nie dotykaja (pre-clean czysci
    // tylko smoke-trio) — see the DECISION in demo-content-seeding.operations.ts.
    const { seedDemoContent_IO } =
      await import('./domain/admin/operations/demo-content-seeding.operations');
    const demoContentResult = await seedDemoContent_IO();
    reportIssueBackend({
      namespace: 'STARTUP',
      message: `Demo Content: ${demoContentResult.message}`,
      payload: null,
      mode: 'info',
    });

    const seedingDurationMs = Math.round(
      Number(process.hrtime.bigint() - seedingStart) / 1_000_000
    );
    reportIssueBackend({
      namespace: 'STARTUP_SEEDING_DURATION',
      message: 'Seeding complete (cold-start metric)',
      payload: { seeding_duration_ms: seedingDurationMs },
      mode: 'info',
    });

    // NOTE: there is no cleanup step for DeletedUser here. Archive rows are removed
    // only by the admin purge endpoint.

    // 7. App Logs cleanup (non-blocking)
    void import('./domain/admin/operations/admin-logs.operations').then(
      ({ cleanupOldEventLogs_IO }) =>
        cleanupOldEventLogs_IO({}).then(result => {
          if (result.success && result.data.deleted > 0) {
            reportIssueBackend({
              namespace: 'STARTUP',
              message: `Event Log cleanup: ${result.data.deleted} old records deleted`,
              payload: null,
              mode: 'info',
            });
          }
        })
    );

    // 8. PairingSession expired tokens cleanup: a periodic job of the scheduler (JobLease), run by
    // the first tick or traffic round after boot; no separate unleased startup run.

    // 8.5. SessionContainer expire sweep (non-blocking)
    void import('./domain/session-container/session-container.expire-sweep').then(
      ({ expireStaleSessionContainers }) => void expireStaleSessionContainers()
    );

    // 8.55. DB structural invariants: READ-ONLY check, no DDL (the objects come from migrations,
    // see the DECISION in application/startup/verify-db-invariants.ts). Defined behaviour:
    // - missing / INVALID object (writes NOT protected): report error; STAGING/PRODUCTION abort
    //   the boot (never serve SC-2 or the counter floors unenforced), DEVELOPMENT continues;
    // - CHECK still NOT VALID (new writes protected, old rows unproven): report warn, continue;
    // - the catalog query itself failed: report error and continue (unknown is not missing;
    //   the admin health check repeats the probe and shows the result).
    const {
      verifyDbInvariants,
      isBlockingDbInvariantProblem,
      formatDbInvariantProblems,
    } = await import('./application/startup/verify-db-invariants');
    const invariantProblems = await verifyDbInvariants().catch(
      (error: unknown) => {
        reportIssueBackend({
          namespace: 'STARTUP_DB_INVARIANTS',
          message: 'Could not read DB invariants from the catalog',
          payload: error,
          mode: 'error',
        });
        return [];
      }
    );
    if (invariantProblems.length > 0) {
      const { getEnvironmentMode } =
        await import('./application/environment/environment.utils.api');
      const mode = getEnvironmentMode();
      const blocking = invariantProblems.filter(isBlockingDbInvariantProblem);
      reportIssueBackend({
        namespace: 'STARTUP_DB_INVARIANTS',
        message: `DB invariants not in force: ${formatDbInvariantProblems(invariantProblems)}. Apply the migrations (scripts/db/migrate-deploy.sh), see docs/DEPLOYMENT.md §5.2.`,
        payload: { problems: invariantProblems, mode },
        mode: blocking.length > 0 ? 'error' : 'warn',
      });
      if (
        blocking.length > 0 &&
        (mode === 'STAGING' || mode === 'PRODUCTION')
      ) {
        throw new Error(
          `Boot aborted: required DB invariants not in force in ${mode}: ${formatDbInvariantProblems(blocking)}.`
        );
      }
    }

    // Cached counts backfill, non-blocking. A 24h throttle and a DB advisory lock gate it.
    // It re-syncs StylistAccount.cached_{bookmark,gallery}_count from _count after a race,
    // a dropped inc/dec, or manual SQL. A synced state is one SELECT batch (~50ms) and
    // no UPDATE. Startup runs it after each deploy.
    void import('./application/startup/cached-counts-backfill').then(
      ({ runCachedCountsBackfill }) => void runCachedCountsBackfill()
    );

    // 9. Run smoke tests after startup (optional, controlled by env var)
    const { runSmokeTestsAfterStartup } =
      await import('./application/startup/smoke-tests-runner');
    void runSmokeTestsAfterStartup(); // Non-blocking
  }
}
