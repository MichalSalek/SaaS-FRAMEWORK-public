/**
 * Gallery domain smoke tests
 *
 * Covers: GET_GALLERY_RECORDS, GET_COLORS, GET_TRAITS, CREATE_GALLERY_RECORD,
 *         GALLERY_PIN_UNPIN_RECORD, GALLERY_TRAIT_OPERATIONS, GALLERY_DYNAMIC_COLORS_TRAITS,
 *         GALLERY_EXPLORE (public, filters, pagination)
 */

import { test, apiCall, getData, assert } from './_test-utils';
import type { TestContext } from './_test-utils';
import { NAIL_LENGTHS } from '@kernel/domain/gallery/nail-length.config';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import { getDefaultGalleryIds } from '../utils/test-data-setup';

export async function runGalleryTests(ctx: TestContext): Promise<void> {
  await test('GET_GALLERY_RECORDS', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/gallery/get-gallery-records?apply_strict_filter=true',
      method: 'GET',
      token: ctx.stylistToken,
    });
    assert.status(response, 200);

    const data =
      getData<GALLERY_DTO_API_V1['GET_GALLERY_RECORDS']['RESPONSE']>(response);
    assert.equals(Array.isArray(data.records), true);
    assert.hasProperty(
      data as unknown as Record<string, unknown>,
      'nextCursor'
    );
    if (data.records.length > 0) {
      assert.hasProperty(
        data.records[0] as unknown as Record<string, unknown>,
        'gallery_record_id'
      );
      assert.hasProperty(
        data.records[0] as unknown as Record<string, unknown>,
        'asset_url'
      );
      assert.hasProperty(
        data.records[0] as unknown as Record<string, unknown>,
        'nail_length'
      );
    }
  });

  await test('GET_COLORS', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/gallery/colors',
      method: 'GET',
      token: ctx.stylistToken,
    });
    assert.status(response, 200);
    const data =
      getData<GALLERY_DTO_API_V1['GET_COLORS']['RESPONSE']>(response);
    assert.equals(Array.isArray(data), true, 'colors should be array');
    if (data.length > 0) {
      assert.hasProperty(data[0] as unknown as Record<string, unknown>, 'id');
      assert.hasProperty(data[0] as unknown as Record<string, unknown>, 'name');
      assert.hasProperty(
        data[0] as unknown as Record<string, unknown>,
        'hex_code'
      );
    }
  });

  await test('GET_TRAITS', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/gallery/traits',
      method: 'GET',
      token: ctx.stylistToken,
    });
    assert.status(response, 200);
    const data =
      getData<GALLERY_DTO_API_V1['GET_TRAITS']['RESPONSE']>(response);
    assert.equals(Array.isArray(data), true, 'traits should be array');
    if (data.length > 0) {
      assert.hasProperty(data[0] as unknown as Record<string, unknown>, 'id');
      assert.hasProperty(data[0] as unknown as Record<string, unknown>, 'name');
      assert.hasProperty(
        data[0] as unknown as Record<string, unknown>,
        'category'
      );
    }
  });

  await test('CREATE_GALLERY_RECORD', async () => {
    // Ensure stylist role
    await apiCall({
      endpoint: '/api/v1/user/switch-role',
      method: 'POST',
      token: ctx.stylistToken,
      body: { account_type: AccountTypeValue.STYLIST },
    });

    const { color_id, trait_id } = await getDefaultGalleryIds(ctx.stylistToken);

    // TypeScript pilnuje REQUEST
    const requestBody: GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['REQUEST'] =
      {
        asset_url: `https://res.cloudinary.com/smoke-test-${Date.now()}.jpg`,
        trait_ids: [trait_id],
        color_ids: [color_id],
        nail_length: NAIL_LENGTHS.MEDIUM,
      };

    const response = await apiCall({
      endpoint: '/api/v1/gallery/create-gallery-record',
      method: 'POST',
      token: ctx.stylistToken,
      body: requestBody,
    });
    assert.status(response, 201);

    // TypeScript pilnuje RESPONSE i podpowiada!
    const data =
      getData<GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['RESPONSE']>(
        response
      );
    assert.equals(
      typeof data.gallery_record_id,
      'string',
      'gallery_record_id should be string'
    );

    // Cleanup
    if (data.gallery_record_id) {
      await apiCall({
        endpoint: '/api/v1/gallery/delete-record',
        method: 'POST',
        token: ctx.stylistToken,
        body: { gallery_record_id: data.gallery_record_id },
      });
    }
  });

  await test('GALLERY_PIN_UNPIN_RECORD', async () => {
    const { color_id, trait_id } = await getDefaultGalleryIds(ctx.stylistToken);
    // Create record
    const createBody: GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['REQUEST'] = {
      asset_url: `https://res.cloudinary.com/pin-test-${Date.now()}.jpg`,
      trait_ids: [trait_id],
      color_ids: [color_id],
      nail_length: NAIL_LENGTHS.SHORT,
    };

    const createResponse = await apiCall({
      endpoint: '/api/v1/gallery/create-gallery-record',
      method: 'POST',
      token: ctx.stylistToken,
      body: createBody,
    });
    const createData =
      getData<GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['RESPONSE']>(
        createResponse
      );
    const recordId = createData.gallery_record_id;

    try {
      // Pin record
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
      const pinData =
        getData<GALLERY_DTO_API_V1['GALLERY_PIN_RECORD']['RESPONSE']>(
          pinResponse
        );
      assert.equals(pinData.success, true, 'pin should succeed');
      assert.equals(
        typeof pinData.pinned_count,
        'number',
        'pinned_count should be number'
      );

      // Unpin record
      const unpinBody: GALLERY_DTO_API_V1['GALLERY_UNPIN_RECORD']['REQUEST'] = {
        gallery_record_id: recordId,
      };

      const unpinResponse = await apiCall({
        endpoint: '/api/v1/gallery/unpin-record',
        method: 'POST',
        token: ctx.stylistToken,
        body: unpinBody,
      });
      assert.status(unpinResponse, 200);
      const unpinData =
        getData<GALLERY_DTO_API_V1['GALLERY_UNPIN_RECORD']['RESPONSE']>(
          unpinResponse
        );
      assert.equals(unpinData.success, true, 'unpin should succeed');
      assert.equals(
        typeof unpinData.pinned_count,
        'number',
        'pinned_count should be number'
      );
    } finally {
      // Cleanup always runs even if assertions fail
      await apiCall({
        endpoint: '/api/v1/gallery/delete-record',
        method: 'POST',
        token: ctx.stylistToken,
        body: { gallery_record_id: recordId },
      });
    }
  });

  await test('GALLERY_TRAIT_OPERATIONS', async () => {
    const { color_id, trait_id } = await getDefaultGalleryIds(ctx.stylistToken);
    // Test validates trait usage in records
    const requestBody: GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['REQUEST'] =
      {
        asset_url: `https://res.cloudinary.com/trait-test-${Date.now()}.jpg`,
        trait_ids: [trait_id],
        color_ids: [color_id],
        nail_length: NAIL_LENGTHS.MEDIUM,
      };

    const response = await apiCall({
      endpoint: '/api/v1/gallery/create-gallery-record',
      method: 'POST',
      token: ctx.stylistToken,
      body: requestBody,
    });
    assert.status(response, 201);

    const data =
      getData<GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['RESPONSE']>(
        response
      );

    try {
      // Assertions on created record (extensible)
      assert.equals(
        typeof data.gallery_record_id,
        'string',
        'gallery_record_id should be string'
      );
    } finally {
      // Cleanup always runs even if assertions fail
      await apiCall({
        endpoint: '/api/v1/gallery/delete-record',
        method: 'POST',
        token: ctx.stylistToken,
        body: { gallery_record_id: data.gallery_record_id },
      });
    }
  });

  await test('GALLERY_DYNAMIC_COLORS_TRAITS', async () => {
    // Verify GET_COLORS returns valid data
    const colorsResponse = await apiCall({
      endpoint: '/api/v1/gallery/colors',
      method: 'GET',
      token: ctx.stylistToken,
    });
    assert.status(colorsResponse, 200);
    const colors =
      getData<GALLERY_DTO_API_V1['GET_COLORS']['RESPONSE']>(colorsResponse);
    assert.equals(Array.isArray(colors), true, 'colors should be array');
    if (colors.length > 0) {
      assert.hasProperty(colors[0] as unknown as Record<string, unknown>, 'id');
      assert.hasProperty(
        colors[0] as unknown as Record<string, unknown>,
        'hex_code'
      );
    }

    // Verify GET_TRAITS returns valid data
    const traitsResponse = await apiCall({
      endpoint: '/api/v1/gallery/traits',
      method: 'GET',
      token: ctx.stylistToken,
    });
    assert.status(traitsResponse, 200);
    const traits =
      getData<GALLERY_DTO_API_V1['GET_TRAITS']['RESPONSE']>(traitsResponse);
    assert.equals(Array.isArray(traits), true, 'traits should be array');
    if (traits.length > 0) {
      assert.hasProperty(traits[0] as unknown as Record<string, unknown>, 'id');
      assert.hasProperty(
        traits[0] as unknown as Record<string, unknown>,
        'name'
      );
    }

    // Create record with dynamic color/trait IDs (if available)
    const colorIds = colors.length > 0 ? [colors[0].id] : [];
    const traitIds = traits.length > 0 ? [traits[0].id] : [];

    const createBody: GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['REQUEST'] = {
      asset_url: `https://res.cloudinary.com/dynamic-test-${Date.now()}.jpg`,
      trait_ids: traitIds,
      color_ids: colorIds,
      nail_length: NAIL_LENGTHS.MEDIUM,
    };

    const createResponse = await apiCall({
      endpoint: '/api/v1/gallery/create-gallery-record',
      method: 'POST',
      token: ctx.stylistToken,
      body: createBody,
    });
    assert.status(createResponse, 201);

    const data =
      getData<GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['RESPONSE']>(
        createResponse
      );

    try {
      assert.equals(
        typeof data.gallery_record_id,
        'string',
        'gallery_record_id should be string'
      );
    } finally {
      await apiCall({
        endpoint: '/api/v1/gallery/delete-record',
        method: 'POST',
        token: ctx.stylistToken,
        body: { gallery_record_id: data.gallery_record_id },
      });
    }
  });

  // ============================================================================
  // GALLERY EXPLORE — Public endpoint, cursor-based pagination
  // ============================================================================

  await test('GALLERY_EXPLORE_PUBLIC', async () => {
    // Explore requires LOGGED_USER_PERMISSIONS (SSOT: permissions.config.ts)
    const response = await apiCall({
      endpoint: '/api/v1/gallery/explore',
      method: 'GET',
      token: ctx.stylistToken,
    });
    assert.status(response, 200);

    const data =
      getData<GALLERY_DTO_API_V1['EXPLORE_GALLERY_RECORDS']['RESPONSE']>(
        response
      );
    assert.equals(Array.isArray(data.records), true, 'records should be array');
    if (data.records.length > 0) {
      assert.hasProperty(
        data.records[0] as unknown as Record<string, unknown>,
        'gallery_record_id'
      );
      assert.hasProperty(
        data.records[0] as unknown as Record<string, unknown>,
        'asset_url'
      );
      assert.hasProperty(
        data.records[0] as unknown as Record<string, unknown>,
        'nail_length'
      );
    }
    // nextCursor should be string or null
    assert.equals(
      data.nextCursor === null || typeof data.nextCursor === 'string',
      true,
      'nextCursor should be string or null'
    );
  });

  await test('GALLERY_EXPLORE_WITH_FILTERS', async () => {
    // Call with nail_length filter.
    // NOTE: nail_length is the UPPERCASE NailLength enum per the contract
    // (gallery.dto EXPLORE_GALLERY_RECORDS.REQUEST: nail_length?: NailLength =
    // SHORT|MEDIUM|LONG|XL). The backend narrows via isNailLengthNarrower
    // (case-sensitive, matching the enum) — a lowercase 'medium' is an INVALID
    // value and is gracefully ignored (no filter applied), which previously made
    // this test pass only by accident when explore had no cross-stylist non-MEDIUM
    // record. Send the canonical uppercase constant so the filter is actually
    // exercised.
    const response = await apiCall({
      endpoint: `/api/v1/gallery/explore?nail_length=${NAIL_LENGTHS.MEDIUM}`,
      method: 'GET',
      token: ctx.stylistToken,
    });
    assert.status(response, 200);

    const data =
      getData<GALLERY_DTO_API_V1['EXPLORE_GALLERY_RECORDS']['RESPONSE']>(
        response
      );
    assert.equals(
      Array.isArray(data.records),
      true,
      'filtered records should be array'
    );

    // If records returned, verify nail_length matches filter
    for (const record of data.records) {
      assert.equals(
        record.nail_length,
        NAIL_LENGTHS.MEDIUM,
        `Expected nail_length 'MEDIUM', got '${record.nail_length}'`
      );
    }
  });

  await test('GALLERY_EXPLORE_PAGINATION', async () => {
    // Request small page (take=1), get cursor, then fetch next page
    const firstResponse = await apiCall({
      endpoint: '/api/v1/gallery/explore?take=1',
      method: 'GET',
      token: ctx.stylistToken,
    });
    assert.status(firstResponse, 200);

    const firstData =
      getData<GALLERY_DTO_API_V1['EXPLORE_GALLERY_RECORDS']['RESPONSE']>(
        firstResponse
      );
    assert.equals(
      Array.isArray(firstData.records),
      true,
      'first page records should be array'
    );

    // Only test pagination if there is a next page
    if (firstData.nextCursor) {
      const secondResponse = await apiCall({
        endpoint: `/api/v1/gallery/explore?take=1&cursor=${encodeURIComponent(firstData.nextCursor)}`,
        method: 'GET',
        token: ctx.stylistToken,
      });
      assert.status(secondResponse, 200);

      const secondData =
        getData<GALLERY_DTO_API_V1['EXPLORE_GALLERY_RECORDS']['RESPONSE']>(
          secondResponse
        );
      assert.equals(
        Array.isArray(secondData.records),
        true,
        'second page records should be array'
      );

      // Ensure pages return different records (if both have data)
      if (firstData.records.length > 0 && secondData.records.length > 0) {
        assert.equals(
          firstData.records[0].gallery_record_id !==
            secondData.records[0].gallery_record_id,
          true,
          'Pagination should return different records on different pages'
        );
      }
    }
    // If no nextCursor, dataset is too small for pagination — test still passes
  });

  await test('GALLERY_EXPLORE_INVALID_PARAMS', async () => {
    // Send invalid params via query — GET with invalid take defaults to 30
    // Invalid nail_length is passed as-is (string) — backend uses the string value
    const response = await apiCall({
      endpoint:
        '/api/v1/gallery/explore?nail_length=invalid_value&take=not_a_number',
      method: 'GET',
      token: ctx.stylistToken,
    });
    // With GET query params, invalid numeric params default to fallback values,
    // so the request succeeds (200) — the API is lenient with query params.
    assert.status(
      response,
      200,
      'Invalid query params should be handled gracefully'
    );
  });
}
