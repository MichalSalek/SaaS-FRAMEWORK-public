/**
 * Recovery Domain Smoke Tests (Scenario A8)
 *
 * Full lifecycle: create user → onboard → gallery record → self-delete (soft) → check recovery → restore → verify data
 */

import crypto from 'crypto';
import {
  test,
  apiCall,
  getData,
  assert,
  getAdminToken,
  extractSessionToken,
} from './_test-utils';
import type { TestContext } from './_test-utils';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import { NAIL_LENGTHS } from '@kernel/domain/gallery/nail-length.config';

/**
 * Generate a delete-confirm token for a given userId. Tokens are signed with the
 * development fallback secret; see the backend token utilities. version=0 is
 * correct for a brand-new temp user.
 */
function generateDeleteConfirmToken(userId: string, version = 0): string {
  const DEV_UNSUBSCRIBE_SECRET = 'dev-email-unsubscribe-secret-change-me';
  const secretSuffix = 'delete-confirm';
  const baseSecret =
    process.env.EMAIL_UNSUBSCRIBE_SECRET || DEV_UNSUBSCRIBE_SECRET;
  const secret = `${baseSecret}-${secretSuffix}`;

  const timestamp = Date.now();
  const payload = `${userId}:delete:${version}:${timestamp}`;
  const payloadBase64 = Buffer.from(payload).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
  return `${payloadBase64}.${signature}`;
}

export async function runRecoveryDomainTests(_ctx: TestContext): Promise<void> {
  await test('RECOVERY_FULL_LIFECYCLE', async () => {
    const tempEmail = `temp-recovery-domain-${Date.now()}@example.com`;
    let tempUserId: string | null = null;
    let newUserId: string | null = null;
    let newToken: string | null = null;

    try {
      // 1. Create temp user via dev-login
      const loginRes = await apiCall({
        endpoint: '/api/auth/dev-login',
        method: 'POST',
        body: { email: tempEmail },
      });
      assert.status(loginRes, 200);
      const loginData =
        getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(loginRes);
      const tempToken = extractSessionToken(loginRes);
      tempUserId = loginData.id;

      // 2. Onboard as stylist
      const onboardRes = await apiCall({
        endpoint: '/api/v1/user/onboard-stylist',
        method: 'POST',
        token: tempToken,
        body: { display_name: 'Recovery Test Stylist', address_city: 'Warsaw' },
      });
      if (onboardRes.status !== 200 && onboardRes.status !== 201) {
        throw new Error(`Onboard failed: ${onboardRes.status}`);
      }

      // 3. Fetch dynamic color/trait IDs (avoid hardcoded DB IDs)
      const colorsRes = await apiCall({
        endpoint: '/api/v1/gallery/colors',
        token: tempToken,
      });
      const colors = getData<Array<{ id: string }>>(colorsRes);
      const traitsRes = await apiCall({
        endpoint: '/api/v1/gallery/traits',
        token: tempToken,
      });
      const traits = getData<Array<{ id: string }>>(traitsRes);
      if (!colors.length || !traits.length)
        throw new Error('No colors or traits in DB');
      const dynamicColorId = colors[0].id;
      const dynamicTraitId = traits[0].id;

      // 4. Create gallery record with colors and traits
      const createRes = await apiCall({
        endpoint: '/api/v1/gallery/create-gallery-record',
        method: 'POST',
        token: tempToken,
        body: {
          asset_url: 'https://res.cloudinary.com/recovery-test.jpg',
          color_ids: [dynamicColorId],
          trait_ids: [dynamicTraitId],
          nail_length: NAIL_LENGTHS.MEDIUM,
        },
      });
      assert.status(createRes, 201);

      // 5. Self-delete (soft-delete): tempUser deletes own account via delete/confirm.
      // Bypasses email step by generating the HMAC token inline (dev env only).
      // Soft-delete sets is_active=false, deleted_at=now(), recovery_available=true.
      const deleteConfirmToken = generateDeleteConfirmToken(tempUserId!);
      const deleteRes = await apiCall({
        endpoint: `/api/v1/user/delete/confirm?token=${encodeURIComponent(deleteConfirmToken)}`,
        method: 'GET',
        token: tempToken,
      });
      assert.status(deleteRes, 200);

      // 6+7. Re-login (dev-login finds the soft-deleted user by email, creates a new
      // session). Recovery state (recovery_available, deleted_at) is in SafeCurrentUser
      // returned by dev-login — check-recovery endpoint is intentionally uniform (anti-
      // enumeration: always returns recovery_available:false regardless of email).
      const reLoginRes = await apiCall({
        endpoint: '/api/auth/dev-login',
        method: 'POST',
        body: { email: tempEmail },
      });
      assert.status(reLoginRes, 200);
      const reLoginData =
        getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(reLoginRes);
      newToken = extractSessionToken(reLoginRes);
      newUserId = reLoginData.id;

      // 6. Check recovery → verify via currentUser fields (post-login, not check-recovery).
      assert.equals(
        reLoginData.recovery_available,
        true,
        'Recovery should be available'
      );
      if (!reLoginData.deleted_at) {
        throw new Error('Expected deleted_at to be set after soft-delete');
      }

      // 8. Reactivate account in-place (Model A soft-delete recovery).
      // Uses /reactivate (reactivateAccount_IO): flips is_active=true, deleted_at=null,
      // recovery_available=false. Gallery records were never deleted — no restore needed.
      const restoreRes = await apiCall({
        endpoint: '/api/v1/user/reactivate',
        method: 'POST',
        token: newToken ?? undefined,
        body: {},
      });
      assert.status(restoreRes, 200);
      const restoreData =
        getData<USER_DTO_API_V1['USER_REACTIVATE_ACCOUNT']['RESPONSE']>(restoreRes);
      assert.equals(restoreData.reactivated, true, 'Reactivation should succeed');

      // 9. Verify stylist account exists
      const verifyRes = await apiCall({
        endpoint: '/api/v1/session/get-current',
        token: newToken ?? undefined,
      });
      assert.status(verifyRes, 200);
      const verifyData = getData<Record<string, unknown>>(verifyRes);
      if (!verifyData.stylist_account) {
        throw new Error('Stylist account should be restored');
      }

      // 10. Verify gallery records restored with colors/traits
      const galleryRes = await apiCall({
        endpoint: '/api/v1/gallery/get-gallery-records',
        method: 'GET',
        token: newToken ?? undefined,
      });
      assert.status(galleryRes, 200);
      const galleryData =
        getData<{
          records: Array<{
            gallery_record_id: string;
            colors: unknown[];
            traits: unknown[];
          }>;
        }>(galleryRes);
      const records = galleryData.records;
      if (!Array.isArray(records) || records.length < 1) {
        throw new Error(
          `Expected >= 1 restored gallery records, got ${records?.length ?? 0}`
        );
      }
      if (!records[0].colors || records[0].colors.length < 1) {
        throw new Error('Restored record should have colors');
      }
      if (!records[0].traits || records[0].traits.length < 1) {
        throw new Error('Restored record should have traits');
      }
    } finally {
      // Cleanup
      if (newUserId) {
        const cleanupToken = await getAdminToken();
        await apiCall({
          endpoint: '/api/v1/admin/user/delete/any',
          method: 'POST',
          token: cleanupToken,
          body: { id: newUserId },
        }).catch(() => {});
      }
    }
  });
}
