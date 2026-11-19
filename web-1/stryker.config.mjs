


// The access-policy read boundary under test; vitest.mutation.config.ts discovers the tests from this list.
export const MUTATION_PILOT_FILES = [
  'src/domain/pairing/salon-access.resolver.ts',
  'src/domain/pairing/author-access.ts',
  'src/domain/favorites/operations/favorite-access.ts',
  'src/application/http/account-state-guard.ts',
];

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  // DECISION: the command runner, not @stryker-mutator/vitest-runner. Runner 10.0.0 filters a mutant's tests
  // by a name regex joined with spaces while Vitest 5 matches names joined with " > ", so every mutant ran
  // ZERO tests and was reported Survived (measured: 1 of 233 "killed"). The command runner activates the
  // mutant through __STRYKER_ACTIVE_MUTANT__ and runs the whole narrowed set per mutant, still well inside
  // the budget. Revisit when the vitest runner supports Vitest 5.
  testRunner: 'command',
  commandRunner: {
    command: 'npx vitest run --config vitest.mutation.config.ts --reporter=dot',
  },
  coverageAnalysis: 'off',
  mutate: MUTATION_PILOT_FILES,
  // Default mutator set, nothing excluded: string literals ARE the access filters here ('ACTIVE',
  // 'STYLIST', 'SALON'), and object literals are the Prisma where clauses, so both must stay mutated.
  mutator: { excludedMutations: [] },
  // Agent metadata is not needed by tests; its directory symlink cannot be copied as a file.
  ignorePatterns: ['/.agents'],
  tempDirName: '.stryker-tmp',
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'node_modules/.cache/stryker/mutation.html' },
  jsonReporter: { fileName: 'node_modules/.cache/stryker/mutation.json' },
  timeoutMS: 20000,
  concurrency: 4,
  thresholds: { high: 90, low: 75, break: null },
  cleanTempDir: 'always',
};

export default config;
