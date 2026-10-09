/**
 * Smoke Test Setup — Token acquisition, cleanup, pre-test preparation
 *
 * Extracted from run-smoke-tests.ts during modularization.
 */

import {
  apiCall,
  getData,
  getStylistToken,
  getAdminToken,
  getClientToken,
} from './_test-utils';
import type { TestContext } from './_test-utils';

/**
 * Acquire tokens and clean up leftover test data.
 * Returns a TestContext with all tokens and shared results array.
 */
export async function runSetup(): Promise<TestContext> {
  // Import results from shared module
  const { results } = await import('./_test-utils');

  // Get tokens once
  console.log('\uD83D\uDD11 Getting tokens...');
  const stylistToken = await getStylistToken();
  const adminToken = await getAdminToken();
  const clientToken = await getClientToken();
  console.log('   \u2705 Tokens ready\n');

  // Clean up leftover gallery records from previous runs to avoid hitting
  // FREE plan limit (max 5 records) during tests.
  const preCleanGallery = await apiCall({
    endpoint: '/api/v1/gallery/get-gallery-records',
    method: 'GET',
    token: stylistToken,
  });
  const preCleanGalleryData = getData<{
    records: Array<{ gallery_record_id: string }>;
  }>(preCleanGallery);
  const preCleanRecords = Array.isArray(preCleanGalleryData)
    ? preCleanGalleryData
    : (preCleanGalleryData?.records ?? []);
  for (const rec of preCleanRecords) {
    await apiCall({
      endpoint: '/api/v1/gallery/delete-record',
      method: 'POST',
      token: stylistToken,
      body: { gallery_record_id: rec.gallery_record_id },
    });
  }
  if (preCleanRecords.length > 0) {
    console.log(
      `\uD83E\uDDF9 Cleaned ${preCleanRecords.length} leftover gallery records\n`
    );
  }

  // Clean up leftover pairing records to avoid hitting FREE plan limit (max 2 paired clients).
  // Stylist perspective: get-my-pairs returns {user_id, email, paired_at}.
  const preCleanPairs = await apiCall({
    endpoint: '/api/v1/pairing/get-my-pairs',
    method: 'GET',
    token: stylistToken,
  });
  const preCleanPairsData = getData<{
    pairs: Array<{ user_id: string; email: string; paired_at: string }>;
  }>(preCleanPairs);
  const pairsToClean = preCleanPairsData?.pairs || [];
  for (const pair of pairsToClean) {
    await apiCall({
      endpoint: '/api/v1/pairing/revoke-access',
      method: 'POST',
      token: stylistToken,
      body: { target_user_id: pair.user_id },
    });
  }
  if (pairsToClean.length > 0) {
    console.log(
      `\uD83E\uDDF9 Cleaned ${pairsToClean.length} leftover pairing records\n`
    );
  }

  // Enable EXPLORE_ENABLED for the run. Kernel default is OFF (cold-start park)
  // and the explore handler has a back-guard that 404s the discovery feed when
  // disabled. Smoke exercises the explore happy-path, so flip the flag via the
  // admin toggle (row is seeded; toggle flips is_enabled + invalidates the
  // per-instance cache on the same server process \u2192 handler reads live true).
  // Runtime-only (test DB) \u2014 does NOT touch the kernel default shipped to prod.
  await apiCall({
    endpoint: '/api/v1/admin/feature-flags/toggle',
    method: 'POST',
    token: adminToken,
    body: { key: 'explore_enabled', is_enabled: true },
  });

  return {
    stylistToken,
    clientToken,
    adminToken,
    results,
  };
}
