#!/usr/bin/env tsx
/**
 * SMOKE TESTS - FREE Plan Validation + Core Features
 *
 * Philosophy: Automated tests = ONLY smoke tests (happy path + critical)
 * Comprehensive testing = AI Agent reads SSOT and shoots live requests
 *
 * Coverage:
 * - FREE plan limits (max 5 gallery records, max 5 pinned, max 2 paired clients)
 * - Core features (auth, session, user, account, gallery, favorites, pairing)
 * - Security (RBAC, validation, rate limiting, webhook signature enforcement)
 * - Pricing policy enforcement (staff accounts blocked on FREE)
 * - User lifecycle (registration + deletion by self/admin)
 *
 * Rate Limiting:
 * - API: 100 req/10s (10 req/s)
 * - Tests: 39 tests with 300ms delay = ~3.3 req/s (safe margin)
 *
 * Type Safety Pattern:
 * 1. Import DTO types: import type { USER_DTO_API_V1 } from '@kernel/...'
 * 2. Import helper: import { getData } from './utils/api-client'
 * 3. Type request: const body: USER_DTO_API_V1['USER_CHANGE_NAME']['REQUEST'] = { name: 'x' }
 * 4. Type response: const data = getData<USER_DTO_API_V1['USER_CHANGE_NAME']['RESPONSE']>(response)
 * 5. TypeScript now autocompletes and validates structure!
 *
 * Run: sprawdz tests/package.json
 *
 * Architecture: Modular — each domain in smoke/*.smoke.ts, shared utils in smoke/_*.ts
 */

import { results, apiCall, getData, getStylistToken, getClientToken } from './smoke/_test-utils';
import { runSetup } from './smoke/_setup';
import { runRbacMatrix } from './smoke/_rbac-matrix';
import { runAuthTests } from './smoke/auth.smoke';
import { runUserTests } from './smoke/user.smoke';
import { runAccountTests } from './smoke/account.smoke';
import { runGalleryTests } from './smoke/gallery.smoke';
import { runSessionTests } from './smoke/session.smoke';
import { runFavoriteTests } from './smoke/favorite.smoke';
import { runRecoveryTests } from './smoke/recovery.smoke';
import { runPairingTests, runPairingFullFlowTests } from './smoke/pairing.smoke';
import { runClientTests } from './smoke/client.smoke';
import { runEventLogTests } from './smoke/event-log.smoke';
import { runSalonStaffTests } from './smoke/salon-staff.smoke';
import { runLifecycleTests } from './smoke/lifecycle.smoke';
import { runAdminTests } from './smoke/admin.smoke';
import { runNegativeTests } from './smoke/negative.smoke';
import { runPricingTests } from './smoke/pricing.smoke';
import { runRestoreTests } from './smoke/restore.smoke';
import { runGdprTests } from './smoke/gdpr.smoke';
import { runNewsletterTests } from './smoke/newsletter.smoke';
import { runRateLimitTests } from './smoke/rate-limit.smoke';
import { runRecoveryDomainTests } from './smoke/recovery-domain.smoke';
import { runContractTests } from './smoke/contract.smoke';
import { runQuotaLimitTests } from './smoke/quota-limits.smoke';
import { runAdminContractTests } from './smoke/admin-contract.smoke';
import { runGalleryContractTests } from './smoke/gallery-contract.smoke';
import { runUserContractTests } from './smoke/user-contract.smoke';
import { runPairingContractTests } from './smoke/pairing-contract.smoke';
import { runVisitCrmTests } from './smoke/visit-crm.smoke';
import { runMessagingTests } from './smoke/messaging.smoke';
import { runPairRequestTests } from './smoke/pair-request.smoke';
import { runClientContractTests } from './smoke/client-contract.smoke';
import { runSupportTests } from './smoke/support.smoke';
import { runHighRiskEndpointTests } from './smoke/high-risk-endpoints.smoke';
import { runWebhookTests } from './smoke/webhook.smoke';
import { runCoverageGapTests } from './smoke/coverage-gap.smoke';
import { runExchangeCodeTests } from './smoke/exchange-code.smoke';
import { runAccountContractTests } from './smoke/account-contract.smoke';
import { runSessionContainerContractTests } from './smoke/session-container-contract.smoke';
import { runEmailContractTests } from './smoke/email-contract.smoke';
import { runSalonStaffContractTests } from './smoke/salon-staff-contract.smoke';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';

async function runSmokeTests() {
  console.log('\uD83D\uDD25 SMOKE TESTS - Happy Path + Security\n');
  console.log('Philosophy: Automated = Smoke, Comprehensive = AI Agent\n');
  console.log('Coverage: FREE plan validation + core features\n');
  console.log('Rate limit: 100 req/10s, tests run at ~3.3 req/s\n');

  // ============================================================================
  // SETUP: Token acquisition + cleanup
  // ============================================================================

  const ctx = await runSetup();

  console.log('\uD83D\uDCCB Running smoke tests...\n');

  // ============================================================================
  // AUTH & SESSION (Critical Path)
  // ============================================================================

  await runAuthTests(ctx);

  // ============================================================================
  // USER (Core Operations)
  // ============================================================================

  await runUserTests(ctx);

  // ============================================================================
  // ACCOUNT (Core Operations)
  // ============================================================================

  await runAccountTests(ctx);

  // ============================================================================
  // GALLERY (Core Operations + FREE plan limits)
  // ============================================================================

  await runGalleryTests(ctx);

  // ============================================================================
  // SESSION (Logout + Delete + Disable)
  // ============================================================================

  await runSessionTests(ctx);

  // ============================================================================
  // FAVORITES (Core Operations + FREE plan limits)
  // ============================================================================

  await runFavoriteTests(ctx);

  // ============================================================================
  // ACCOUNT RECOVERY (check recovery status)
  // ============================================================================

  await runRecoveryTests();

  // ============================================================================
  // PAIRING (Core Operations + FREE plan limits: max 2 paired clients)
  // ============================================================================

  await runPairingTests(ctx);

  // ============================================================================
  // CLIENT (Profile + Contact)
  // ============================================================================

  await runClientTests(ctx);

  // ============================================================================
  // EVENT LOG (Core Operations)
  // ============================================================================

  await runEventLogTests(ctx);

  // ============================================================================
  // SALON_STAFF (Pricing Policy Validation)
  // ============================================================================

  await runSalonStaffTests(ctx);

  // ============================================================================
  // USER LIFECYCLE (Registration + Deletion)
  // ============================================================================

  await runLifecycleTests(ctx);

  // ============================================================================
  // ADMIN OPERATIONS
  // ============================================================================

  await runAdminTests(ctx);

  // ============================================================================
  // SUPPORT MESSAGING (Full user + admin flow)
  // ============================================================================

  await runSupportTests(ctx);

  // ============================================================================
  // PAIRING FULL FLOW
  // ============================================================================

  await runPairingFullFlowTests(ctx);

  // ============================================================================
  // KARTA KLIENTKI (wizyty + notatka CRM) — plan-gated, stylist-only
  // ============================================================================

  await runVisitCrmTests(ctx);

  // ============================================================================
  // KOMUNIKATOR (stylistka <-> klientka) — party-gate, unread, REVOKED read-only
  // ============================================================================

  await runMessagingTests(ctx);

  // ============================================================================
  // PROŚBY O POŁĄCZENIE (stały kod QR) — anty-nękanie, idempotencja, anty-oracle
  // ============================================================================

  await runPairRequestTests(ctx);

  // ============================================================================
  // NEGATIVE TESTS (Security & Validation)
  // ============================================================================

  await runNegativeTests(ctx);

  // ============================================================================
  // PRICING LIMIT TESTS
  // ============================================================================

  await runPricingTests(ctx);

  // ============================================================================
  // RESTORE ACCOUNT (FIX 1 regression)
  // ============================================================================

  await runRestoreTests(ctx);

  // ============================================================================
  // GDPR (Data Export)
  // ============================================================================

  await runGdprTests(ctx);

  // ============================================================================
  // NEWSLETTER (Public endpoint)
  // ============================================================================

  await runNewsletterTests(ctx);

  // ============================================================================
  // RATE LIMIT (Strict endpoint — must run after newsletter to avoid interference)
  // ============================================================================

  await runRateLimitTests(ctx);

  // ============================================================================
  // RECOVERY DOMAIN (Full lifecycle: create → delete → check-recovery → restore)
  // ============================================================================

  await runRecoveryDomainTests(ctx);

  // ============================================================================
  // CONTRACT TESTS (Auth/RBAC/validation for DELETE_ASSET)
  // ============================================================================

  await runContractTests(ctx);

  // ============================================================================
  // QUOTA LIMIT TESTS (C3: favorite-stylists-limit, C4: hourly share brake per client-stylist pair)
  // ============================================================================

  await runQuotaLimitTests(ctx);

  // ============================================================================
  // HIGH-RISK ENDPOINT TESTS (Finding #8 — testy-api review)
  // ============================================================================

  await runHighRiskEndpointTests(ctx);

  // ============================================================================
  // WEBHOOK SECURITY (Stripe webhook rejects invalid requests)
  // ============================================================================

  await runWebhookTests();

  // ============================================================================
  // CONTRACT TESTS — ALL REMAINING UNTESTED ENDPOINTS
  // Auth (401), RBAC (403), and validation (400) boundary tests
  // ============================================================================

  console.log('\n\uD83D\uDCDD CONTRACT TESTS (All remaining endpoints)\n');

  await runAdminContractTests(ctx);
  await runGalleryContractTests(ctx);
  await runUserContractTests(ctx);
  await runPairingContractTests(ctx);
  await runClientContractTests(ctx);
  await runAccountContractTests(ctx);
  await runSessionContainerContractTests(ctx);
  await runEmailContractTests(ctx);
  await runSalonStaffContractTests(ctx);

  // ============================================================================
  // COVERAGE GAP TESTS (MEDIUM+ risk endpoints previously untested)
  // ============================================================================

  console.log('\n🔍 COVERAGE GAP TESTS\n');
  await runCoverageGapTests(ctx);

  // ============================================================================
  // EXCHANGE-CODE CONTRACT (variant C token bridge)
  // ============================================================================

  console.log('\n🔑 EXCHANGE-CODE CONTRACT TESTS\n');
  await runExchangeCodeTests(ctx);

  // ============================================================================
  // RBAC FULL MATRIX (SSOT-driven: ROUTES_API x permissions.config x APP_EVENTS)
  // ============================================================================

  console.log('\n\uD83D\uDD10 RBAC FULL MATRIX\n');

  // Get fresh tokens -- previous tests may have invalidated them via session operations
  // Wait for rate limit cooldown (lifecycle tests create/delete many users)
  console.log('   Waiting 3s for rate limit cooldown...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  console.log('   Refreshing tokens for RBAC matrix...');
  const rbacStylistToken = await getStylistToken();
  const rbacClientToken = await getClientToken();

  // Verify tokens work before starting matrix
  const verifyS = await apiCall({ endpoint: '/api/v1/session/get-current', token: rbacStylistToken });
  const verifyC = await apiCall({ endpoint: '/api/v1/session/get-current', token: rbacClientToken });
  console.log(`   Stylist token: ${verifyS.status === 200 ? 'OK' : 'FAILED'} (role_id: ${(verifyS.body as Record<string, unknown> & {data?: {role_id?: string}}).data?.role_id})`);
  console.log(`   Client token: ${verifyC.status === 200 ? 'OK' : 'FAILED'} (role_id: ${(verifyC.body as Record<string, unknown> & {data?: {role_id?: string}}).data?.role_id})`);

  // Reset test users to their canonical roles before RBAC matrix
  // (previous tests like USER_SWITCH_ROLE and USER_ONBOARD_IDEMPOTENT may have changed them)
  await apiCall({
    endpoint: '/api/v1/user/switch-role',
    method: 'POST',
    token: rbacStylistToken,
    body: { account_type: AccountTypeValue.STYLIST },
  });
  await apiCall({
    endpoint: '/api/v1/user/switch-role',
    method: 'POST',
    token: rbacClientToken,
    body: { account_type: AccountTypeValue.CLIENT },
  });

  // Clean up gallery records before RBAC matrix -- previous tests may have
  // left records, causing FREE plan limit (5) to block CREATE_GALLERY_RECORD
  // which returns 403 (indistinguishable from RBAC deny).
  const preRbacGallery = await apiCall({
    endpoint: '/api/v1/gallery/get-gallery-records',
    method: 'GET',
    token: rbacStylistToken,
  });
  const preRbacGalleryData = getData<{records: Array<{gallery_record_id: string}>}>(preRbacGallery);
  const preRbacRecords = Array.isArray(preRbacGalleryData)
    ? preRbacGalleryData
    : (preRbacGalleryData?.records ?? []);
  for (const rec of preRbacRecords) {
    await apiCall({
      endpoint: '/api/v1/gallery/delete-record',
      method: 'POST',
      token: rbacStylistToken,
      body: { gallery_record_id: rec.gallery_record_id },
    });
  }
  if (preRbacRecords.length > 0) {
    console.log(`   Cleaned ${preRbacRecords.length} leftover gallery records before RBAC matrix`);
  }

  await runRbacMatrix(rbacStylistToken, rbacClientToken);

  // ============================================================================
  // SUMMARY
  // ============================================================================

  console.log('\n' + '='.repeat(80));
  console.log('\uD83D\uDCCA SMOKE TEST SUMMARY');
  console.log('='.repeat(80));

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const total = results.length;

  console.log(`Total: ${total}`);
  console.log(`\u2705 Passed: ${passed}`);
  console.log(`\u274C Failed: ${failed}`);
  console.log(`Success rate: ${((passed / total) * 100).toFixed(1)}%`);

  if (failed > 0) {
    console.log('\n\u274C FAILED TESTS:');
    results
      .filter(r => r.status === 'FAIL')
      .forEach(r => {
        console.log(`   - ${r.endpoint}`);
        console.log(`     ${r.error}`);
      });
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n\uD83D\uDCA1 For comprehensive testing, use AI Agent:');
  console.log('   Agent reads SSOT (routing.config.ts, DTOs, permissions)');
  console.log('   Agent shoots live requests with multiple scenarios');
  console.log('   Agent generates detailed report\n');
  console.log('\u26A0\uFE0F  Stripe webhook: security layer tested, event processing requires manual testing');
  console.log('   See tests/README.md for manual testing guide\n');

  process.exit(failed > 0 ? 1 : 0);
}

runSmokeTests().catch(error => {
  console.error('\uD83D\uDCA5 Smoke tests crashed:', error);
  process.exit(1);
});
