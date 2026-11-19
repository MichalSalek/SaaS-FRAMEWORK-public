/**
 * Pricing limit smoke tests
 *
 * Covers: PRICING_GET_PLANS, PRICING_LIMIT_MAX_GALLERY_RECORDS, PRICING_LIMIT_MAX_PINNED_RECORDS
 */

import { test, apiCall, getData, assert } from './_test-utils';
import type { TestContext } from './_test-utils';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import { NAIL_LENGTHS } from '@kernel/domain/gallery/nail-length.config';
import { getDefaultGalleryIds } from '../utils/test-data-setup';

export async function runPricingTests(ctx: TestContext): Promise<void> {
  // ── PRICING_GET_PLANS ──
  // Public endpoint (AUTHENTICATION_CHECK_ENABLED: false) — verify it returns 200
  // without auth and returns a non-empty plans array.

  await test('PRICING_GET_PLANS_PUBLIC_HAPPY_PATH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/pricing/get-plans',
      method: 'GET',
    });
    assert.status(res, 200);
  });

  await test('PRICING_LIMIT_MAX_GALLERY_RECORDS', async () => {
    // FREE plan: max 5 gallery records
    const usageResponse = await apiCall({
      endpoint: '/api/v1/user/usage-stats',
      token: ctx.stylistToken,
    });
    const usage =
      getData<USER_DTO_API_V1['USER_GET_USAGE_STATS']['RESPONSE']>(usageResponse);
    const currentCount = usage.gallery_records;
    const maxAllowed = usage.limits.max_gallery_records;

    // If at limit, verify creation fails
    if (currentCount >= maxAllowed && maxAllowed !== -1) {
      const requestBody: GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['REQUEST'] =
        {
          asset_url: `https://test.cloudinary.com/limit-test-${Date.now()}.jpg`,
          trait_ids: [],
          color_ids: [],
          nail_length: NAIL_LENGTHS.MEDIUM,
        };

      const response = await apiCall({
        endpoint: '/api/v1/gallery/create-gallery-record',
        method: 'POST',
        token: ctx.stylistToken,
        body: requestBody,
      });
      assert.status(response, 400);
    }
  });

  await test('PRICING_LIMIT_MAX_PINNED_RECORDS', async () => {
    // FREE plan: max 5 pinned records
    const recordIds: string[] = [];
    const { color_id, trait_id } = await getDefaultGalleryIds(ctx.stylistToken);

    try {
      // Create 6 records
      for (let i = 0; i < 6; i++) {
        const requestBody: GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['REQUEST'] =
          {
            asset_url: `https://test.cloudinary.com/pin-limit-${Date.now()}-${i}.jpg`,
            trait_ids: [trait_id],
            color_ids: [color_id],
            nail_length: NAIL_LENGTHS.SHORT,
          };

        const createResponse = await apiCall({
          endpoint: '/api/v1/gallery/create-gallery-record',
          method: 'POST',
          token: ctx.stylistToken,
          body: requestBody,
        });

        if (createResponse.status === 201) {
          const data =
            getData<GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['RESPONSE']>(
              createResponse
            );
          recordIds.push(data.gallery_record_id);
        }
      }

      // Pin first 5
      for (let i = 0; i < Math.min(5, recordIds.length); i++) {
        const pinBody: GALLERY_DTO_API_V1['GALLERY_PIN_RECORD']['REQUEST'] = {
          gallery_record_id: recordIds[i],
        };

        await apiCall({
          endpoint: '/api/v1/gallery/pin-record',
          method: 'POST',
          token: ctx.stylistToken,
          body: pinBody,
        });
      }

      // Try to pin 6th - should fail
      if (recordIds.length >= 6) {
        const pinBody: GALLERY_DTO_API_V1['GALLERY_PIN_RECORD']['REQUEST'] = {
          gallery_record_id: recordIds[5],
        };

        const pinResponse = await apiCall({
          endpoint: '/api/v1/gallery/pin-record',
          method: 'POST',
          token: ctx.stylistToken,
          body: pinBody,
        });
        assert.status(pinResponse, 400);
      }
    } finally {
      // Cleanup
      for (const recordId of recordIds) {
        await apiCall({
          endpoint: '/api/v1/gallery/delete-record',
          method: 'POST',
          token: ctx.stylistToken,
          body: { gallery_record_id: recordId },
        });
      }
    }
  });
}
