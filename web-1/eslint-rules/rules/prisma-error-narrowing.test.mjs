// @vitest-environment node
import guard from './prisma-error-narrowing.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester();
const PI = "import { Prisma } from '../../../prisma/js-client';\n";
const instanceofError = [{ messageId: 'instanceof' }];
const p2025 = [{ messageId: 'p2025' }];

tester.run('nf/prisma-error-narrowing', guard.rule, {
  valid: [
    // structural detectors and local sentinel classes
    "import { isP2025 } from '@app/db/prisma-error';\nconst ok = (e: unknown) => isP2025(e);",
    'class Rollback extends Error {}\nconst ok = (e: unknown) => e instanceof Rollback;',
    'class PrismaLikeError extends Error {}\nconst ok = (e: unknown) => e instanceof PrismaLikeError;',
    'const ok = (e: unknown) => e instanceof Error;',
    // P2025 as data, not a compare
    "const fake = { code: 'P2025' };",
    "const other = (e: { code: string }) => e.code === 'P2002';",
    // prose: line comment, block comment, string, template
    '// e instanceof Prisma.PrismaClientKnownRequestError\nconst a = 1;',
    "/* code === 'P2025' */\nconst a = 1;",
    "const s = 'e instanceof Prisma.PrismaClientKnownRequestError';",
    "const t = `code === 'P2025'`;",
    // escape with a reason, same line and within three lines above
    PI +
      'const f = (e: unknown) => e instanceof Prisma.X; // prisma-error-narrowing-allow: wire-format probe',
    PI +
      '// prisma-error-narrowing-allow: legacy adapter test\n\nconst f = (e: unknown) => e instanceof Prisma.X;',
  ],
  invalid: [
    {
      code:
        PI +
        'const f = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError;',
      errors: instanceofError,
    },
    {
      code: PI + 'const f = (e: unknown) => e instanceof Prisma.Decimal;',
      errors: instanceofError,
    },
    // undeclared ambient Prisma, as the grep read it
    {
      code: 'const f = (e: unknown) => e instanceof Prisma.PrismaClientValidationError;',
      errors: instanceofError,
    },
    // aliases the grep could not see
    {
      code: "import { Prisma as P } from '../../prisma/js-client';\nconst f = (e: unknown) => e instanceof P.PrismaClientKnownRequestError;",
      errors: instanceofError,
    },
    {
      code: "import * as client from '../../prisma/js-client';\nconst f = (e: unknown) => e instanceof client.Prisma.PrismaClientKnownRequestError;",
      errors: instanceofError,
    },
    {
      code:
        PI +
        'const { PrismaClientKnownRequestError } = Prisma;\nconst f = (e: unknown) => e instanceof PrismaClientKnownRequestError;',
      errors: instanceofError,
    },
    {
      code:
        PI +
        'const { PrismaClientKnownRequestError: KnownError } = Prisma;\nconst f = (e: unknown) => e instanceof KnownError;',
      errors: instanceofError,
    },
    {
      code:
        PI +
        'const KnownError = Prisma.PrismaClientKnownRequestError;\nconst f = (e: unknown) => e instanceof KnownError;',
      errors: instanceofError,
    },
    {
      code:
        PI +
        'const P = Prisma;\nconst f = (e: unknown) => e instanceof P.PrismaClientKnownRequestError;',
      errors: instanceofError,
    },
    {
      code: "import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';\nconst f = (e: unknown) => e instanceof PrismaClientKnownRequestError;",
      errors: instanceofError,
    },
    {
      code: 'const f = (e: unknown) => e instanceof (Prisma.PrismaClientKnownRequestError as any);',
      errors: instanceofError,
    },
    // bare P2025 compares, every operator and order
    {
      code: "const f = (e: { code: string }) => e.code === 'P2025';",
      errors: p2025,
    },
    {
      code: 'const f = (e: { code: string }) => e.code === "P2025";',
      errors: p2025,
    },
    {
      code: "const f = (e: { code: string }) => 'P2025' === e.code;",
      errors: p2025,
    },
    {
      code: "const f = (e: { code: string }) => e.code !== 'P2025';",
      errors: p2025,
    },
    {
      code: 'const f = (e: { code: string }) => e.code == `P2025`;',
      errors: p2025,
    },
    {
      code: "function f(e: { code: string }) { switch (e.code) { case 'P2025': return 1; } return 0; }",
      errors: p2025,
    },
    // escape marker without a reason escapes nothing; outside the 3-line window neither
    {
      code:
        PI +
        '// prisma-error-narrowing-allow:\nconst f = (e: unknown) => e instanceof Prisma.X;',
      errors: [{ messageId: 'bareMarker' }],
    },
    {
      code:
        PI +
        '// prisma-error-narrowing-allow: far away\n\n\n\n\nconst f = (e: unknown) => e instanceof Prisma.X;',
      errors: instanceofError,
    },
  ],
});
