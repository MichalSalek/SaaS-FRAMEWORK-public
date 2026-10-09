import { describe, expect, it } from 'vitest';
import {
  PLAYGROUND_ROUTE,
  resolvePlaygroundFramePolicy,
} from './playground-frame.policy';

describe('playground frame policy', () => {
  it.each(['/', '/app/', '/dev/playground/', '/en/stylist/x/'])(
    'fails closed without dev routes: %s',
    path => {
      expect(resolvePlaygroundFramePolicy(path, false)).toEqual({
        canEmbedSelf: false,
        canBeEmbeddedBySelf: false,
      });
    }
  );

  it('lets only the playground frame, in every locale and slash form', () => {
    for (const path of [
      PLAYGROUND_ROUTE,
      `${PLAYGROUND_ROUTE}/`,
      `/en${PLAYGROUND_ROUTE}/`,
      `/de${PLAYGROUND_ROUTE}`,
    ]) {
      expect(resolvePlaygroundFramePolicy(path, true).canEmbedSelf).toBe(true);
    }
    for (const path of ['/', '/app/', '/dev/playground-other/', '/en/']) {
      expect(resolvePlaygroundFramePolicy(path, true).canEmbedSelf).toBe(false);
    }
  });

  it('lets any dev route be framed by its own origin', () => {
    expect(
      resolvePlaygroundFramePolicy('/app/', true).canBeEmbeddedBySelf
    ).toBe(true);
  });
});
