import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';

const DOMAIN = 'https://nailfolio.app';
const MEDIA_PATH = /^\/img\/blog\/[a-f0-9]{64}\.(?:webp|png|jpg)$/;

// V2 is identified by its content-addressed cover and reviewed cover alt.
// Older posts retain their original mirror, even when they have other covers.
export function mirrorBlogMedia(body, coverImage, coverImageAlt) {
  if (
    typeof coverImage !== 'string' ||
    !MEDIA_PATH.test(coverImage) ||
    typeof coverImageAlt !== 'string' ||
    !coverImageAlt.trim()
  )
    return body;
  const tree = fromMarkdown(body, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const images = [];
  function visit(node) {
    if (node.type === 'imageReference')
      throw new Error('V2 image references are unsupported');
    if (node.type === 'image') images.push(node);
    for (const child of node.children ?? []) visit(child);
  }
  visit(tree);
  let result = body;
  for (const image of images.reverse()) {
    if (!MEDIA_PATH.test(image.url) || image.title != null)
      throw new Error('Invalid V2 image path');
    const { start, end } = image.position;
    const source = result.slice(start.offset, end.offset);
    const replaced = source.replace(
      `](${image.url})`,
      `](${DOMAIN}${image.url})`
    );
    if (source === replaced) throw new Error('Unsupported V2 image syntax');
    result =
      result.slice(0, start.offset) + replaced + result.slice(end.offset);
  }
  const alt = coverImageAlt
    .replace(/&/g, '&amp;')
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');
  return `![${alt}](${DOMAIN}${coverImage})\n\n${result}`;
}
