import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/**
 * Shared MSW server for the Node test runtime (Vitest + jsdom).
 * Lifecycle is wired in `main/vitest.setup.ts`.
 *
 * Per-test usage:
 *   mswServer.use(http.get('*\/api/v1/...', () => HttpResponse.json(...)))
 */
export const mswServer = setupServer(...handlers);
