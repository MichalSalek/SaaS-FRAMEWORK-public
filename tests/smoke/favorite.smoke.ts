/**
 * Favorite domain smoke tests
 *
 * Covers: GET_BOOKMARKED_STYLISTS, FAVORITE_GET_RECORDS, FAVORITE_UPDATE_RECORD_NOTE
 */

import { test, apiCall, getData, assert } from './_test-utils';
import type { TestContext } from './_test-utils';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import type { FAVORITE_DTO_API_V1 } from '@kernel/models/favorites/favorite.dto';
import { getDefaultGalleryIds } from '../utils/test-data-setup';

export async function runFavoriteTests(ctx: TestContext): Promise<void> {
  await test('GET_BOOKMARKED_STYLISTS', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/bookmark/get-bookmarked',
      method: 'GET',
      token: ctx.clientToken,
    });
    assert.status(response, 200);

    const data =
      getData<FAVORITE_DTO_API_V1['GET_BOOKMARKED_STYLISTS']['RESPONSE']>(
        response
      );
    assert.equals(Array.isArray(data.records), true);
    assert.hasProperty(
      data as unknown as Record<string, unknown>,
      'nextCursor'
    );
    if (data.records.length > 0) {
      assert.hasProperty(
        data.records[0] as unknown as Record<string, unknown>,
        'id'
      );
      assert.hasProperty(
        data.records[0] as unknown as Record<string, unknown>,
        'stylist_account_id'
      );
    }
  });

  await test('FAVORITE_GET_RECORDS', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/favorite/get-records',
      method: 'GET',
      token: ctx.clientToken,
    });
    assert.status(response, 200);

    const data =
      getData<FAVORITE_DTO_API_V1['FAVORITE_GET_RECORDS']['RESPONSE']>(response);
    assert.equals(Array.isArray(data.records), true);
    if (data.records.length > 0) {
      assert.hasProperty(
        data.records[0] as unknown as Record<string, unknown>,
        'id'
      );
      assert.hasProperty(
        data.records[0] as unknown as Record<string, unknown>,
        'gallery_record_id'
      );
      assert.hasProperty(
        data.records[0] as unknown as Record<string, unknown>,
        'asset_url'
      );
    }
  });

  await test('FAVORITE_UPDATE_RECORD_NOTE', async () => {
    const { color_id, trait_id } = await getDefaultGalleryIds(ctx.stylistToken);
    // Create gallery record -> add to favorites -> update note -> clear note -> cleanup
    const createBody: GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['REQUEST'] = {
      asset_url: `https://res.cloudinary.com/note-test-${Date.now()}.jpg`,
      trait_ids: [trait_id],
      color_ids: [color_id],
      nail_length: 'SHORT',
    };

    const createResponse = await apiCall({
      endpoint: '/api/v1/gallery/create-gallery-record',
      method: 'POST',
      token: ctx.stylistToken,
      body: createBody,
    });
    assert.status(createResponse, 201);
    const createData =
      getData<GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['RESPONSE']>(
        createResponse
      );
    const recordId = createData.gallery_record_id;

    // Pin the record so it satisfies the access guard in addRecordToFavorites_IO
    // (SSOT §5.1: client can favorite a record only if is_pinned=true OR active pair with stylist)
    const pinBody: GALLERY_DTO_API_V1['GALLERY_PIN_RECORD']['REQUEST'] = {
      gallery_record_id: recordId,
    };
    const pinResponse = await apiCall({
      endpoint: '/api/v1/gallery/pin-record',
      method: 'POST',
      token: ctx.stylistToken,
      body: pinBody,
    });
    assert.status(pinResponse, 200);

    try {
      // Add record to favorites (client-only operation)
      const addFavResponse = await apiCall({
        endpoint: '/api/v1/favorite/add-record',
        method: 'POST',
        token: ctx.clientToken,
        body: { gallery_record_id: recordId },
      });
      // Accept 201 (added) or 409 (already favorited)
      if (addFavResponse.status !== 201 && addFavResponse.status !== 409) {
        throw new Error(`Add favorite failed: ${addFavResponse.status}`);
      }

      // Update note (client-only)
      const updateNoteBody: FAVORITE_DTO_API_V1['FAVORITE_UPDATE_RECORD_NOTE']['REQUEST'] =
        {
          gallery_record_id: recordId,
          note: 'Smoke test note',
        };
      const updateResponse = await apiCall({
        endpoint: '/api/v1/favorite/update-record-note',
        method: 'POST',
        token: ctx.clientToken,
        body: updateNoteBody,
      });
      assert.status(updateResponse, 200);
      const updateData =
        getData<FAVORITE_DTO_API_V1['FAVORITE_UPDATE_RECORD_NOTE']['RESPONSE']>(
          updateResponse
        );
      assert.hasProperty(
        updateData as unknown as Record<string, unknown>,
        'gallery_record_id'
      );
      assert.equals(updateData.note, 'Smoke test note', 'note should match');

      // Clear note (set to null, client-only)
      const clearNoteBody: FAVORITE_DTO_API_V1['FAVORITE_UPDATE_RECORD_NOTE']['REQUEST'] =
        {
          gallery_record_id: recordId,
          note: null,
        };
      const clearResponse = await apiCall({
        endpoint: '/api/v1/favorite/update-record-note',
        method: 'POST',
        token: ctx.clientToken,
        body: clearNoteBody,
      });
      assert.status(clearResponse, 200);
      const clearData =
        getData<FAVORITE_DTO_API_V1['FAVORITE_UPDATE_RECORD_NOTE']['RESPONSE']>(
          clearResponse
        );
      assert.equals(clearData.note, null, 'note should be null after clearing');
    } finally {
      // Cleanup: remove favorite (client) + unpin (stylist) + delete gallery record (stylist)
      await apiCall({
        endpoint: '/api/v1/favorite/remove-record',
        method: 'POST',
        token: ctx.clientToken,
        body: { gallery_record_id: recordId },
      });
      await apiCall({
        endpoint: '/api/v1/gallery/unpin-record',
        method: 'POST',
        token: ctx.stylistToken,
        body: { gallery_record_id: recordId },
      });
      await apiCall({
        endpoint: '/api/v1/gallery/delete-record',
        method: 'POST',
        token: ctx.stylistToken,
        body: { gallery_record_id: recordId },
      });
    }
  });
}
