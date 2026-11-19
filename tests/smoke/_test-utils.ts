/**
 * Smoke Test Utilities - Shared types, test wrapper, results tracking
 *
 * Extracted from run-smoke-tests.ts during modularization.
 */

// ============================================================================
// TYPES
// ============================================================================

export type TestResult = {
  endpoint: string;
  status: 'PASS' | 'FAIL';
  duration: number;
  error?: string | undefined;
};

export type TestContext = {
  stylistToken: string;
  clientToken: string;
  adminToken: string;
  results: TestResult[];
};

// ============================================================================
// GLOBAL STATE
// ============================================================================

/** Shared results array — all modules push to this */
export const results: TestResult[] = [];

/** Fail-fast mode: stop on first failure. Enable via --fail-fast flag or SMOKE_FAIL_FAST=true env var */
export const FAIL_FAST =
  process.argv.includes('--fail-fast') ||
  process.env.SMOKE_FAIL_FAST === 'true';

// ============================================================================
// TEST WRAPPER
// ============================================================================

/**
 * Test wrapper with rate limit protection
 * Adds 300ms delay between tests to stay under 10 req/s limit
 */
export async function test(endpoint: string, fn: () => Promise<void>) {
  const start = Date.now();

  try {
    await fn();
    results.push({ endpoint, status: 'PASS', duration: Date.now() - start });
    console.log(`\u2705 ${endpoint}`);
  } catch (error) {
    results.push({
      endpoint,
      status: 'FAIL',
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    });
    console.log(`\u274C ${endpoint}`);
    console.log(`   ${error instanceof Error ? error.message : String(error)}`);

    if (FAIL_FAST) {
      console.error('\n\uD83D\uDED1 FAIL FAST: Stopping on first failure');
      process.exit(1);
    }
  }

  // Rate limit protection handled by apiCall (150ms min interval per request)
}

// ============================================================================
// RE-EXPORTS for convenience
// ============================================================================

export {
  apiCall,
  getData,
  getEvent,
  getStylistToken,
  getFreshStylistToken,
  getAdminToken,
  getFreshAdminToken,
  getClientToken,
  assert,
  extractSessionToken,
} from '../utils/api-client';
export type {
  HTTPMethod,
  ApiCallOptions,
  ApiResponse,
} from '../utils/api-client';
