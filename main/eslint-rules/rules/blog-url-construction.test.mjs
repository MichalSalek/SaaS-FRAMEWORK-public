// @vitest-environment node
import guard from './blog-url-construction.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester();
const options = [guard.blocks[0].options];
const file = 'src/UI/features/x/page.ts';
const error = [{ messageId: 'handBuilt' }];
const ok = code => ({ code, filename: file, options });
const bad = code => ({ code, filename: file, options, errors: error });

const HAND_BUILT =
  "const DOMAIN = 'https://example.test';\nconst blogPostUrl = (locale: string, slug: string): string => locale + slug;\n\nexport const good = blogPostUrl('en', 'a');\nexport const bad = (slug: string): string => `${DOMAIN}/blog/${slug}/`;";

tester.run('nf/blog-url-construction', guard.rule, {
  valid: [
    // fixture must-pass/helper-only: the pattern only in prose
    ok(
      "// Prose only: the old code built `${DOMAIN}/blog/${slug}/` by hand, which\n// dropped the locale prefix. A comment naming the rule must not trip it.\nconst blogPostUrl = (locale: string, slug: string): string => locale + slug;\n\nexport const url = blogPostUrl('en', 'a');"
    ),
    // the helper file defines the shape
    {
      code: 'export const blogPostUrl = (locale: string, slug: string): string =>\n  `https://example.test/${locale}/blog/${slug}/`;',
      filename: 'src/application/blog/blog.urls.ts',
      options,
    },
    // the correct form
    ok(
      "import { blogPostUrl } from '../../application/blog/blog.urls';\nexport const u = blogPostUrl('en', 's');"
    ),
    // prose in every form
    ok('/* `${DOMAIN}/blog/${slug}/` */\nconst a = 1;'),
    ok("const s = '${DOMAIN}/blog/';"),
    // a route constant without an interpolated prefix is not a built URL
    ok("const BLOG = '/blog';"),
    ok('const t = `/blog/${slug}`;'),
    // a different segment that only starts with "blog"
    ok('const t = `${base}/blogger/${id}`;'),
    // escape with a reason
    ok(
      '// blog-url-allow: RSS spec needs the absolute feed URL\nexport const x = `${DOMAIN}/blog/`;'
    ),
  ],
  invalid: [
    // fixture must-fail/hand-built
    bad(HAND_BUILT),
    // fixture must-fail/bare-escape-marker
    bad(`// blog-url-allow:\n${HAND_BUILT}`),
    bad('export const x = `${DOMAIN}/blog`;'),
    bad('export const x = `${DOMAIN}/blog?page=2`;'),
    bad('export const x = `${DOMAIN}/blog#top`;'),
    // forms the grep could not see
    bad('export const x = `${DOMAIN}/blog${suffix}`;'),
    bad("export const x = DOMAIN + '/blog/' + slug;"),
    bad("export const x = origin + '/blog';"),
  ],
});
