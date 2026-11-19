/**
 * Event Log domain smoke tests
 *
 * Covers: EVENT_LOG_GET_ALL
 */

import { test, apiCall, getData, assert } from './_test-utils';
import type { TestContext } from './_test-utils';
import type { EVENT_LOG_DTO_API_V1 } from '@kernel/models/event-log/event_log.dto';

export async function runEventLogTests(ctx: TestContext): Promise<void> {
  await test('EVENT_LOG_GET_ALL', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/event-log/get-all?type=LOGIN',
      method: 'GET',
      token: ctx.stylistToken,
    });
    assert.status(response, 200);

    const data = getData<EVENT_LOG_DTO_API_V1['EVENT_LOG_GET_ALL']['RESPONSE']>(response);
    assert.equals(Array.isArray(data.records), true);
    assert.hasProperty(
      data as unknown as Record<string, unknown>,
      'nextCursor'
    );
    if (data.records.length > 0) {
      assert.hasProperty(
        data.records[0] as unknown as Record<string, unknown>,
        'event_log_id'
      );
      assert.hasProperty(
        data.records[0] as unknown as Record<string, unknown>,
        'event'
      );
      assert.hasProperty(
        data.records[0] as unknown as Record<string, unknown>,
        'event_type'
      );
      assert.hasProperty(
        data.records[0] as unknown as Record<string, unknown>,
        'created_at'
      );
    }
  });
}
