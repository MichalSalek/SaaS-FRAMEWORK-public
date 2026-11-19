// Fixture job (standalone, no imports).
declare const defineScheduledJob: (job: unknown) => unknown;
export const orphanJob = defineScheduledJob({
  name: 'fixture-job',
  intervalMs: 1,
  wakesOnTick: true,
  run: async () => undefined,
});
