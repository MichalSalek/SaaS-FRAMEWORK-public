// Fixture: a sweep that keeps its own per-process throttle.
let lastRunAt = 0;
export const shouldAttemptFixtureCleanup = (): boolean => Date.now() - lastRunAt > 1;
export const markFixtureCleanup = (): void => {
  lastRunAt = Date.now();
};
