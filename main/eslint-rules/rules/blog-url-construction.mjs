// nf/blog-url-construction — every blog URL comes from application/blog/blog.urls.ts.
//
// Successor of tests/audit/blog-url-construction.sh. A blog post lives in one
// locale, so its URL needs that locale's prefix and the trailing slash; hand-built copies once
// sent BlogPosting JSON-LD, the EN category page and /en/rss.xml to 404s.
// Reported: a template literal whose text right after an interpolation starts a `/blog` segment
// (`${origin}/blog/…`, `${base}/blog`, `${base}/blog?x`, `${base}/blog${slug}`), and the same
// built with `+` (`origin + '/blog/'`), which the grep could not see. Comments and string
// contents are not code. Escape: `// blog-url-allow: <reason>` in a comment (reason mandatory).
import { countSite } from '../lib.mjs';
import {
  hasEscapeWithReason,
  matchesAny,
  relativeFile,
  staticString,
} from './_guard-files.mjs';

const BLOG_SEGMENT = /^\/blog([/?#]|$)/;
const HELPER_CALL = /^blog(Index|Post|Category|Rss)(Url|Path)$/;

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Blog URLs only through blog.urls.ts (locale prefix + trailing slash).',
    },
    schema: [
      {
        type: 'object',
        properties: { helper: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    messages: {
      handBuilt:
        'Builds a blog URL by hand: use blogIndexUrl / blogPostUrl / blogCategoryUrl / blogRssPath from application/blog/blog.urls.ts. Deliberate exception: // blog-url-allow: <reason>.',
    },
  },
  create(context) {
    const helper = context.options[0]?.helper ?? [];
    if (matchesAny(relativeFile(context), helper)) {
      return {};
    }
    let escaped;
    function report(node) {
      escaped ??= hasEscapeWithReason(context.sourceCode, 'blog-url-allow');
      if (!escaped) {
        context.report({ node, messageId: 'handBuilt' });
      }
    }
    return {
      CallExpression(node) {
        // The presence floor: helper CALL sites, so a rename to zero fails.
        if (
          node.callee.type === 'Identifier' &&
          HELPER_CALL.test(node.callee.name)
        ) {
          countSite('blog-url-construction');
        }
      },
      TemplateLiteral(node) {
        for (let i = 1; i < node.quasis.length; i += 1) {
          if (BLOG_SEGMENT.test(node.quasis[i].value.cooked ?? '')) {
            report(node);
            return;
          }
        }
      },
      BinaryExpression(node) {
        if (node.operator !== '+') {
          return;
        }
        const right = staticString(node.right);
        if (
          right !== null &&
          staticString(node.left) === null &&
          BLOG_SEGMENT.test(right)
        ) {
          report(node);
        }
      },
    };
  },
};

export default {
  name: 'blog-url-construction',
  replaces: 'tests/audit/blog-url-construction.sh',
  rule,
  blocks: [
    {
      files: ['src/**/*.{ts,tsx}'],
      ignores: ['**/*.test.ts', '**/*.test.tsx'],
      options: {
        // The helper is where the blog URL shape is defined.
        helper: ['src/application/blog/blog.urls.ts'],
      },
    },
  ],
  presence: { minSites: 12, what: 'blog URL helper call sites in main/src' },
  paths: ['src/application/blog/blog.urls.ts'],
};
