// nf/gallery-junction-mapper — colour and trait junction rows map in one place.
//
// Successor of tests/audit/gallery-junction-mapper.sh. `.color.hex_code` and
// `.trait.is_featured` are the leaves of a hand-rolled junction mapper. They belong in
// gallery.utils.api.ts. A reduced projection keeps a same-line
// `gallery-mapper-allow: <reason>`. A marker in a string does not count.
import path from 'node:path';
import { countSite, staticPropertyName, unwrapTs } from '../lib.mjs';

const OWNER = 'src/domain/gallery/gallery.utils.api.ts';

function relativeFile(context) {
  return path.relative(context.cwd, context.filename).replaceAll('\\', '/');
}

function objectHasLeaf(pattern, leaf) {
  if (pattern?.type !== 'ObjectPattern') {
    return false;
  }
  return pattern.properties.some(prop => {
    if (prop.type !== 'Property' || prop.key?.type !== 'Identifier') {
      return false;
    }
    return prop.key.name === leaf && prop.value?.type !== 'ObjectPattern';
  });
}

function nestedJunction(pattern) {
  if (pattern?.type !== 'ObjectPattern') {
    return null;
  }
  for (const prop of pattern.properties) {
    if (prop.type !== 'Property' || prop.key?.type !== 'Identifier') {
      continue;
    }
    if (prop.key.name === 'color' && objectHasLeaf(prop.value, 'hex_code')) {
      return '.color.hex_code';
    }
    if (prop.key.name === 'trait' && objectHasLeaf(prop.value, 'is_featured')) {
      return '.trait.is_featured';
    }
  }
  return null;
}

function sameLineAllow(sourceCode, node) {
  const line = node.loc?.start.line;
  return sourceCode.getAllComments().some(comment => {
    if (comment.loc?.start.line !== line) {
      return false;
    }
    return comment.value
      .split('\n')
      .some(text => /gallery-mapper-allow:[ \t]*\S/.test(text));
  });
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Gallery colour and trait junction fields are mapped only in gallery.utils.api.ts.',
    },
    schema: [],
    messages: {
      inline:
        'Inline junction read `{{what}}`. Use mapGalleryColors/mapGalleryTraits. Same-line escape: gallery-mapper-allow: <reason>.',
    },
  },
  create(context) {
    const owner = relativeFile(context) === OWNER;
    const sourceCode = context.sourceCode;
    return {
      MemberExpression(node) {
        countSite('gallery-junction-mapper');
        const leaf = staticPropertyName(node);
        const parent = staticPropertyName(unwrapTs(node.object));
        const what =
          leaf === 'hex_code' && parent === 'color'
            ? '.color.hex_code'
            : leaf === 'is_featured' && parent === 'trait'
              ? '.trait.is_featured'
              : null;
        if (!what) {
          return;
        }
        if (owner || sameLineAllow(sourceCode, node)) {
          return;
        }
        context.report({ node, messageId: 'inline', data: { what } });
      },
      VariableDeclarator(node) {
        const init = unwrapTs(node.init);
        const parent =
          init?.type === 'MemberExpression' ? staticPropertyName(init) : null;
        const fromMember =
          parent === 'color' && objectHasLeaf(node.id, 'hex_code')
            ? '.color.hex_code'
            : parent === 'trait' && objectHasLeaf(node.id, 'is_featured')
              ? '.trait.is_featured'
              : null;
        const what = fromMember ?? nestedJunction(node.id);
        if (!what || owner || sameLineAllow(sourceCode, node)) {
          return;
        }
        context.report({ node, messageId: 'inline', data: { what } });
      },
    };
  },
};

export default {
  name: 'gallery-junction-mapper',
  replaces: 'tests/audit/gallery-junction-mapper.sh',
  rule,
  blocks: [{ files: ['src/domain/**/*.ts'] }],
  presence: {
    minSites: 15000,
    what: 'member expressions inspected in web-1/src/domain',
  },
  paths: [OWNER],
};
