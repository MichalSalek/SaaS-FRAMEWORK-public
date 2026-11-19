import { describe, expect, it, vi } from 'vitest';
import { __setDb } from '../../test-utils/setup';
import { seedGalleryData } from './gallery.seed';

describe('seedGalleryData batching', () => {
  it('uses four fixed SQL operations instead of one update per seed row', async () => {
    const colorCreateMany = vi.fn(async () => ({ count: 0 }));
    const traitCreateMany = vi.fn(async () => ({ count: 0 }));
    const executeRaw = vi.fn(async () => 1);
    __setDb({
      color: { createMany: colorCreateMany },
      trait: { createMany: traitCreateMany },
      $executeRaw: executeRaw,
    });

    await seedGalleryData();

    expect(colorCreateMany).toHaveBeenCalledTimes(1);
    expect(traitCreateMany).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalledTimes(2);
  });
});
