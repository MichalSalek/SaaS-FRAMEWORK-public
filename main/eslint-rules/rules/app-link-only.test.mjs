// @vitest-environment node
import guard from './app-link-only.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester({ jsx: true });
const options = [guard.blocks[0].options];
const page = 'src/UI/features/x/Page.tsx';
const error = [{ messageId: 'bare' }];
const ok = code => ({ code, filename: page, options });
const bad = code => ({ code, filename: page, options, errors: error });

tester.run('nf/app-link-only', guard.rule, {
  valid: [
    // fixture must-pass/wrapper-only: prose in a comment, a local AppLinkAtom
    ok(
      "// Prose only: we no longer write import Link from 'next/link' here.\nconst AppLinkAtom = (href: string): string => href;\n\nexport const used = AppLinkAtom('/blog');"
    ),
    // the correct form
    ok(
      "import { AppLinkAtom as Link } from '../../components/AppLink/AppLink.atom';\nexport const A = () => <Link href='/blog'>b</Link>;"
    ),
    // the wrapper itself
    {
      code: "import NextLink from 'next/link';\nexport const AppLinkAtom = NextLink;",
      filename: 'src/UI/components/AppLink/AppLink.atom.tsx',
      options,
    },
    // prose in every other form
    ok("/* import Link from 'next/link' */\nconst a = 1;"),
    ok('const s = "import Link from \'next/link\'";'),
    ok('const t = `from next/link ${1}`;'),
    // another module of next
    ok("import Image from 'next/image';"),
    // escape with a reason
    ok(
      "// app-link-allow: external preview needs raw prefetch control\nimport Link from 'next/link';"
    ),
  ],
  invalid: [
    // fixture must-fail/bare-import
    bad(
      "import Link from 'next/link';\n\nexport const AppLinkAtom = Link;\nexport const used = AppLinkAtom;"
    ),
    // fixture must-fail/bare-escape-marker: a marker without a reason is not an escape
    bad(
      "// app-link-allow:\nimport Link from 'next/link';\n\nexport const AppLinkAtom = Link;\nexport const used = AppLinkAtom;"
    ),
    bad("/* app-link-allow: */\nimport Link from 'next/link';"),
    // the escape is read from comments only, never from a string
    bad("const s = 'app-link-allow: x';\nimport Link from 'next/link';"),
    // every door to the module, which the grep (`from 'next/link'`) partly missed
    bad('import Link from "next/link";'),
    bad("import type { LinkProps } from 'next/link';"),
    bad("export { default } from 'next/link';"),
    bad("export * from 'next/link';"),
    bad("const L = import('next/link');"),
    bad("const L = require('next/link');"),
    bad("type P = typeof import('next/link');"),
    bad('const L = import(`next/link`);'),
  ],
});
