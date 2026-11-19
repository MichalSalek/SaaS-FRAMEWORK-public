import { describe, expect, it, vi } from 'vitest';
import { __setDb } from '../../../test-utils/setup';
import { batchResolveLocales } from './email-locale-batch.resolver';

describe('locale resolution for one-shot broadcasts', () => {
  it('propagates infrastructure failures in strict mode, preserving the retry path', async () => {
    __setDb({
      $queryRaw: vi.fn(async () => {
        throw new Error('locale store unavailable');
      }),
    });
    await expect(
      batchResolveLocales(['client'], { strict: true })
    ).rejects.toThrow('locale store unavailable');
  });
  it('preserves the established lifecycle fallback when strict mode is absent', async () => {
    __setDb({
      $queryRaw: vi.fn(async () => {
        throw new Error('locale store unavailable');
      }),
    });
    expect(await batchResolveLocales(['client'])).toEqual(new Map());
  });
  it('still returns known languages and leaves missing preferences to the normal default', async () => {
    __setDb({
      $queryRaw: vi.fn(async () => [
        { created_by_user_id: 'client', language: 'en' },
      ]),
    });
    expect(
      await batchResolveLocales(['client', 'new-client'], { strict: true })
    ).toEqual(new Map([['client', 'en']]));
  });
});
