// @vitest-environment node
import guard from './import-aliases.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester();
const domainFile = '/w/src/domain/gallery/operations/x.operations.ts';
const appFile = '/w/src/application/http/x.ts';
const pageFile = '/w/src/pages/api/v1/gallery/index.ts';
const deep = [{ messageId: 'deep' }];

tester.run('nf/import-aliases', guard.rule, {
  valid: [
    {
      filename: domainFile,
      code: "import { a } from '@app/a';\nimport { b } from '@domain/pairing/b';",
    },
    // one step up: a sibling module
    { filename: domainFile, code: "import { b } from '../gallery.utils';" },
    {
      filename: '/w/src/domain/gallery/x.ts',
      code: "import { p } from '../pairing/p';",
    },
    // deep but outside application/ and domain/
    {
      filename: domainFile,
      code: "import type { Prisma } from '../../../prisma/js-client';",
    },
    {
      filename: '/w/src/test-utils/a/b.test.ts',
      code: "import { h } from '../../pages/api/h';",
    },
    // prose never counts
    {
      filename: domainFile,
      code: "// import { x } from '../../../application/x'\n/* from '../../domain/x' */\nconst s = \"from '../../../application/x'\";\nconst t = `import('../../../domain/x')`;",
    },
  ],
  invalid: [
    {
      filename: domainFile,
      code: "import { x } from '../../../application/x';",
      errors: deep,
    },
    {
      filename: pageFile,
      code: "import { x } from '../../../../domain/gallery/x';",
      errors: deep,
    },
    {
      filename: pageFile,
      code: "export { x } from '../../../../domain/gallery/x';",
      errors: deep,
    },
    {
      filename: pageFile,
      code: "export * from '../../../../application/x';",
      errors: deep,
    },
    {
      filename: appFile,
      code: "import type { T } from '../../domain/t';",
      errors: deep,
    },
    {
      filename: appFile,
      code: "const m = () => import('../../domain/x');",
      errors: deep,
    },
    {
      filename: appFile,
      code: "const m = require('../../domain/x');",
      errors: deep,
    },
    {
      filename: appFile,
      code: "type T = import('../../domain/x').T;",
      errors: deep,
    },
    {
      filename: appFile,
      code: "import x = require('../../domain/x');",
      errors: deep,
    },
    {
      filename: '/w/src/test-utils/a/b.test.ts',
      code: "vi.mock('../../application/x');",
      errors: deep,
    },
    {
      filename: '/w/src/test-utils/a/b.test.ts',
      code: "const real = await vi.importActual('../../domain/x');",
      errors: deep,
    },
    // `./` prefix
    {
      filename: appFile,
      code: "import { x } from './../../domain/x';",
      errors: deep,
    },
    // resolves into domain/ without naming it (cross-slice deep relative)
    {
      filename: domainFile,
      code: "import { p } from '../../pairing/p';",
      errors: deep,
    },
    {
      filename: '/w/src/application/a/b/c.ts',
      code: "import { x } from '../../http/x';",
      errors: deep,
    },
  ],
});
