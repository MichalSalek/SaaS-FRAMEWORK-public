import test from 'node:test';
import assert from 'node:assert/strict';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { mirrorBlogMedia } from './blog-mirror-media.mjs';

test('V2 mirror includes reviewed cover and absolute inline image at its original position', () => {
  const cover = `/img/blog/${'a'.repeat(64)}.png`,
    inline = `/img/blog/${'b'.repeat(64)}.webp`;
  const alt = 'Cover [detail] & \\ more';
  const body = `Before\n\n![Inline](${inline})\n\nAfter`;
  const result = mirrorBlogMedia(body, cover, alt);
  assert.equal(
    result,
    `![Cover \\[detail\\] &amp; \\\\ more](https://nailfolio.app${cover})\n\nBefore\n\n![Inline](https://nailfolio.app${inline})\n\nAfter`
  );
  const tree = fromMarkdown(result);
  assert.equal(tree.children[0].children[0].alt, alt);
  assert.equal(mirrorBlogMedia(body, '/img/legacy.webp', 'old'), body);
  assert.throws(
    () => mirrorBlogMedia('![x](//evil.example/x)', cover, alt),
    /path/
  );
  assert.equal(mirrorBlogMedia('body', cover, ''), 'body');
});
