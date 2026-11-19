import { afterEach, describe, expect, it, vi } from 'vitest';
import { cropToFile } from './imageCrop.utils';

describe('profile crop output', () => {
  afterEach(() => vi.restoreAllMocks());
  it.each([
    ['avatar', 'image/jpeg', 'jpg'],
    ['logo', 'image/png', 'png'],
  ] as const)(
    'exports %s with matching bytes and filename',
    async (suffix, format, ext) => {
      const drawImage = vi.fn();
      const toBlob = vi.fn((callback: BlobCallback, type?: string) =>
        callback(new Blob(['x'], { type: type ?? '' }))
      );
      vi.spyOn(document, 'createElement').mockReturnValue({
        getContext: () => ({ drawImage }),
        toBlob,
        width: 0,
        height: 0,
      } as unknown as HTMLCanvasElement);
      const image = {
        naturalWidth: 400,
        naturalHeight: 400,
        width: 200,
        height: 200,
      } as HTMLImageElement;
      const file = await cropToFile(
        image,
        { x: 0, y: 0, width: 100, height: 100, unit: 'px' },
        'original.png',
        suffix,
        format
      );
      expect(toBlob).toHaveBeenCalledWith(
        expect.any(Function),
        format,
        expect.any(Number)
      );
      expect(file.type).toBe(format);
      expect(file.name).toBe(`original-${suffix}.${ext}`);
    }
  );
});
