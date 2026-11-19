import { defineConfig } from 'vitest/config';
import unitConfig from './vitest.config';

/** Real database tests have their own client and never enter the unit/handler suite. */
export default defineConfig({
  ...unitConfig,
  test: {
    ...unitConfig.test,
    include: ['tests/postgres/**/*.test.ts'],
  },
});
